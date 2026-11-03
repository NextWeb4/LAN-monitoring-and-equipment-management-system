using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace Lantern;

/// <summary>Bounded, native IPv4 probes; no shell commands or external scanner dependencies.</summary>
public sealed class NetworkProbe
{
    private const int MaxPorts = 16;
    private static readonly SemaphoreSlim ArpSlots = new(16, 16);
    private static readonly byte[] EchoPayload = "Lantern local network monitor"u8.ToArray();
    private readonly object adapterLock = new();
    private AdapterSnapshot[]? adapterCache;
    private long adapterReadAt;

    public IReadOnlyList<AdapterInfo> GetAdapters() => ReadAdapters().Select(x => x.Info).ToArray();

    public static bool IsAllowedIp(string ip) =>
        TryParseIpv4(ip, out var address) && (IsPrivate(address) || IPAddress.IsLoopback(address));

    public static string[] ExpandSubnet(string subnet)
    {
        var parts = (subnet ?? "").Trim().Split('/');
        if (parts.Length != 2 || !TryParseIpv4(parts[0], out var address) ||
            !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var prefix) ||
            prefix is < 22 or > 32)
            throw new ArgumentException("请输入私有 IPv4 网段，掩码范围为 /22 至 /32，例如 192.168.1.0/24。", nameof(subnet));

        var mask = PrefixMask(prefix);
        var network = ToUInt32(address) & mask;
        var broadcast = network | ~mask;
        if (!IsPrivate(FromUInt32(network)) || !IsPrivate(FromUInt32(broadcast)))
            throw new ArgumentException("发现范围仅允许 10.0.0.0/8、172.16.0.0/12、192.168.0.0/16 私有地址。", nameof(subnet));

        // /31 point-to-point networks and /32 host routes have no excluded broadcast/network hosts.
        var start = prefix >= 31 ? network : network + 1;
        var end = prefix >= 31 ? broadcast : broadcast - 1;
        var count = checked((int)(end - start + 1));
        if (count > 1024)
            throw new ArgumentException("单次发现最多支持 1024 个地址。", nameof(subnet));
        return Enumerable.Range(0, count).Select(offset => FromUInt32(start + (uint)offset).ToString()).ToArray();
    }

    public async Task<ProbeResult> ProbeAsync(string ip, int[] ports, int packets, int timeoutMs,
        bool resolveName, CancellationToken cancellationToken)
    {
        if (!IsAllowedIp(ip) || !TryParseIpv4(ip, out var address))
            throw new ArgumentException("仅支持规范的私有 IPv4 地址或 127.0.0.0/8 本机诊断地址。", nameof(ip));
        if (packets is < 1 or > 10)
            throw new ArgumentOutOfRangeException(nameof(packets), "每轮 Ping 数量必须为 1 至 10。");
        if (timeoutMs is < 100 or > 10000)
            throw new ArgumentOutOfRangeException(nameof(timeoutMs), "超时必须为 100 至 10000 毫秒。");
        ArgumentNullException.ThrowIfNull(ports);
        var checkedPorts = ports.Distinct().Order().ToArray();
        if (checkedPorts.Length > MaxPorts || checkedPorts.Any(port => port is < 1 or > 65535))
            throw new ArgumentException("每台设备最多监测 16 个 TCP 端口，端口范围为 1 至 65535。", nameof(ports));
        cancellationToken.ThrowIfCancellationRequested();

        var result = new ProbeResult { Ip = address.ToString(), Timestamp = DateTimeOffset.UtcNow };
        var localErrors = new List<string>();
        AdapterSnapshot? direct = null;
        try
        {
            direct = ReadAdapters()
                .Where(x => x.CanArp && (ToUInt32(address) & x.Mask) == (ToUInt32(x.Address) & x.Mask))
                .OrderByDescending(x => x.Prefix)
                .FirstOrDefault();
            // Do not ask ARP for a subnet's network or broadcast address.
            if (direct is { Prefix: < 31 } &&
                (ToUInt32(address) == (ToUInt32(direct.Address) & direct.Mask) ||
                 ToUInt32(address) == ((ToUInt32(direct.Address) & direct.Mask) | ~direct.Mask)))
                direct = null;
        }
        catch (NetworkInformationException exception)
        {
            localErrors.Add($"本机网卡读取失败：{ShortMessage(exception)}");
        }

        // Start ARP concurrently, so its OS-level timeout does not get added after all the echo waits.
        // A timed-out native call continues to own its slot until it actually exits.
        var arpTask = direct is not null && OperatingSystem.IsWindows()
            ? ResolveArpAsync(address, direct, timeoutMs, cancellationToken)
            : Task.FromResult(ArpOutcome.NotApplicable);
        var portTask = ProbePortsAsync(address, checkedPorts, timeoutMs, cancellationToken);
        await ProbeIcmpAsync(address, packets, timeoutMs, result, localErrors, cancellationToken);
        var portResults = await portTask;
        foreach (var outcome in portResults)
        {
            result.Ports.Add(outcome.Result);
            if (outcome.Reachable)
            {
                result.Reachable = true;
                result.Evidence.Add($"TCP {outcome.Result.Port} {(outcome.Result.Status == "open" ? "连接成功" : "返回拒绝连接")}");
            }
            if (outcome.LocalError)
                localErrors.Add($"TCP {outcome.Result.Port} 本机探测错误：{outcome.Result.Error}");
        }

        var arp = await arpTask;
        if (arp.Mac is not null)
        {
            result.Mac = arp.Mac;
            // A local interface match provides its MAC, but is not a new remote ARP observation.
            if (arp.ActiveResponse)
            {
                result.Reachable = true;
                result.Evidence.Add("同链路 ARP 解析成功");
            }
        }
        if (arp.Incomplete)
        {
            result.Evidence.Add(arp.Error ?? "ARP 补充探测未完成");
            // ARP is supplementary. Its OS-level delay or exhausted native slots must not invalidate
            // completed ICMP/TCP observations; only primary probe execution errors suppress outages.
        }
        else if (arp.Error is not null)
        {
            result.Evidence.Add(arp.Error);
        }

        result.LatencyMs = result.Received == 0 ? null : result.RttSumMs / result.Received;
        result.LossPercent = result.Sent == 0 ? null : 100.0 * (result.Sent - result.Received) / result.Sent;
        result.IsComplete = localErrors.Count == 0;
        result.Error = localErrors.Count == 0 ? null : string.Join("；", localErrors.Distinct());

        if (resolveName && result.Reachable)
            result.Hostname = await ResolveNameAsync(address, timeoutMs, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        return result;
    }

    private static async Task ProbeIcmpAsync(IPAddress address, int packets, int timeoutMs, ProbeResult result,
        List<string> localErrors, CancellationToken cancellationToken)
    {
        try
        {
            using var ping = new Ping();
            for (var packet = 0; packet < packets; packet++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                PingReply reply;
                try
                {
                    reply = await ping.SendPingAsync(address, TimeSpan.FromMilliseconds(timeoutMs),
                        EchoPayload, new PingOptions(64, false), cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
                catch (Exception exception) when (exception is PingException or SocketException or
                    InvalidOperationException or NotSupportedException or System.ComponentModel.Win32Exception)
                {
                    // A failed execution is not evidence of an echo packet sent onto the network.
                    localErrors.Add($"ICMP 本机执行失败：{ShortMessage(exception)}");
                    break;
                }

                if (IsLocalIcmpFailure(reply.Status))
                {
                    localErrors.Add($"ICMP 本机未完成发送：{reply.Status}");
                    break;
                }
                result.Sent++;
                if (reply.Status == IPStatus.Success)
                {
                    result.Received++;
                    result.RttSumMs += reply.RoundtripTime;
                    result.Reachable = true;
                }
                else
                {
                    var evidence = reply.Status == IPStatus.TimedOut ? "ICMP 响应超时" : $"ICMP 网络返回：{reply.Status}";
                    if (!result.Evidence.Contains(evidence))
                        result.Evidence.Add(evidence);
                }
                if (packet + 1 < packets)
                    await Task.Delay(150, cancellationToken);
            }
            if (result.Received > 0)
                result.Evidence.Add($"ICMP Echo 应答 {result.Received}/{result.Sent}");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception exception) when (exception is NetworkInformationException or NotSupportedException)
        {
            localErrors.Add($"ICMP 不可用：{ShortMessage(exception)}");
        }
    }

    private static bool IsLocalIcmpFailure(IPStatus status) => status is
        IPStatus.BadDestination or IPStatus.BadHeader or IPStatus.BadOption or IPStatus.BadRoute or
        IPStatus.HardwareError or IPStatus.NoResources or IPStatus.Unknown or IPStatus.IcmpError or
        IPStatus.DestinationScopeMismatch;

    private static async Task<TcpOutcome[]> ProbePortsAsync(IPAddress address, int[] ports, int timeoutMs,
        CancellationToken cancellationToken)
    {
        using var concurrency = new SemaphoreSlim(4, 4);
        return await Task.WhenAll(ports.Select(async port =>
        {
            await concurrency.WaitAsync(cancellationToken);
            try { return await ProbePortAsync(address, port, timeoutMs, cancellationToken); }
            finally { concurrency.Release(); }
        }));
    }

    private static async Task<TcpOutcome> ProbePortAsync(IPAddress address, int port, int timeoutMs,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(timeoutMs);
        using var client = new TcpClient(AddressFamily.InterNetwork);
        var started = Stopwatch.GetTimestamp();
        try
        {
            await client.ConnectAsync(address, port, timeout.Token);
            return new(new(port, "open", Stopwatch.GetElapsedTime(started).TotalMilliseconds), true, false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException)
        {
            return new(new(port, "timeout", null, "连接超时"), false, false);
        }
        catch (SocketException exception) when (exception.SocketErrorCode is SocketError.ConnectionRefused or SocketError.ConnectionReset)
        {
            return new(new(port, "closed", Stopwatch.GetElapsedTime(started).TotalMilliseconds, "目标返回拒绝连接"), true, false);
        }
        catch (SocketException exception) when (exception.SocketErrorCode == SocketError.TimedOut)
        {
            return new(new(port, "timeout", null, "连接超时"), false, false);
        }
        catch (SocketException exception) when (exception.SocketErrorCode is SocketError.HostUnreachable or SocketError.NetworkUnreachable)
        {
            return new(new(port, "error", null, $"网络不可达：{exception.SocketErrorCode}"), false, false);
        }
        catch (Exception exception) when (exception is SocketException or InvalidOperationException or NotSupportedException)
        {
            return new(new(port, "error", null, ShortMessage(exception)), false, true);
        }
    }

    private static async Task<string?> ResolveNameAsync(IPAddress address, int timeoutMs, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Math.Min(timeoutMs, 1500));
        try
        {
            var entry = await Dns.GetHostEntryAsync(address.ToString(), AddressFamily.InterNetwork, timeout.Token);
            var name = entry.HostName.TrimEnd('.');
            return name.Length is > 0 and <= 253 && !IPAddress.TryParse(name, out _) ? name : null;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception exception) when (exception is SocketException or OperationCanceledException or ArgumentException)
        {
            // Reverse DNS is metadata only. A missing PTR record does not affect device reachability.
            return null;
        }
    }

    private static async Task<ArpOutcome> ResolveArpAsync(IPAddress address, AdapterSnapshot adapter, int timeoutMs,
        CancellationToken cancellationToken)
    {
        if (address.Equals(adapter.Address))
            return new(adapter.Info.Mac, false, false, null);

        // SendARP itself has no cancellation/timeout argument. Keep a process-wide finite number of calls,
        // bound the async caller's wait, and do not release the native slot when just the wait is cancelled.
        var waitMs = Math.Clamp(timeoutMs * 3, 1000, 4000);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(waitMs);
        try
        {
            await ArpSlots.WaitAsync(deadline.Token);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException)
        {
            return new(null, false, true, "ARP 探测繁忙，未取得本轮补充证据");
        }

        var nativeTask = Task.Run(() =>
        {
            try
            {
                var buffer = new byte[32];
                uint length = (uint)buffer.Length;
                // Windows SendARP resolves by issuing ARP for this local-link target. Do not substitute
                // a neighbor-cache lookup here: an old cached MAC cannot establish current reachability.
                var error = SendARP(BitConverter.ToUInt32(address.GetAddressBytes()),
                    BitConverter.ToUInt32(adapter.Address.GetAddressBytes()), buffer, ref length);
                if (error == 0 && length == 6 && buffer.Take(6).Any(value => value != 0) && (buffer[0] & 1) == 0)
                    return new ArpOutcome(FormatMac(buffer.Take(6).ToArray()), true, false, null);
                // ERROR_BAD_NET_NAME / ERROR_GEN_FAILURE / ERROR_TIMEOUT commonly represent no ARP answer.
                if (error is 31 or 67 or 121 or 1231)
                    return new ArpOutcome(null, false, false, "同链路 ARP 未收到响应");
                return new ArpOutcome(null, false, true, $"ARP 本机解析未完成（系统代码 {error}）");
            }
            catch (Exception exception) when (exception is DllNotFoundException or EntryPointNotFoundException or
                BadImageFormatException or System.ComponentModel.Win32Exception)
            {
                return new ArpOutcome(null, false, true, $"ARP 本机执行失败：{ShortMessage(exception)}");
            }
            finally { ArpSlots.Release(); }
        }, CancellationToken.None);
        try { return await nativeTask.WaitAsync(deadline.Token); }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException)
        {
            return new(null, false, true, "ARP 等待超时，本轮无补充证据");
        }
    }

    private AdapterSnapshot[] ReadAdapters()
    {
        lock (adapterLock)
        {
            if (adapterCache is not null && Stopwatch.GetElapsedTime(adapterReadAt) < TimeSpan.FromSeconds(5))
                return adapterCache;
            var adapters = new List<AdapterSnapshot>();
            foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (adapter.OperationalStatus != OperationalStatus.Up || adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                    continue;
                try
                {
                    var properties = adapter.GetIPProperties();
                    var gateway = properties.GatewayAddresses.Select(x => x.Address)
                        .FirstOrDefault(x => x.AddressFamily == AddressFamily.InterNetwork && !x.Equals(IPAddress.Any));
                    var macBytes = adapter.GetPhysicalAddress().GetAddressBytes();
                    var mac = macBytes.Length == 6 && macBytes.Any(x => x != 0) ? FormatMac(macBytes) : null;
                    var canArp = adapter.NetworkInterfaceType is NetworkInterfaceType.Ethernet or NetworkInterfaceType.Wireless80211 or
                        NetworkInterfaceType.GigabitEthernet or NetworkInterfaceType.FastEthernetFx or NetworkInterfaceType.FastEthernetT;
                    foreach (var unicast in properties.UnicastAddresses)
                    {
                        var address = unicast.Address;
                        if (address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(address) ||
                            address.Equals(IPAddress.Any) || address.GetAddressBytes()[0] >= 224)
                            continue;
                        var prefix = MaskPrefix(unicast.IPv4Mask);
                        if (prefix is < 1 or > 32)
                            continue;
                        var mask = PrefixMask(prefix);
                        var subnet = $"{FromUInt32(ToUInt32(address) & mask)}/{prefix}";
                        adapters.Add(new(new AdapterInfo(adapter.Id, adapter.Name, address.ToString(), subnet,
                            gateway?.ToString(), mac), address, mask, prefix, canArp));
                    }
                }
                catch (NetworkInformationException)
                {
                    // An adapter can disappear during enumeration. Other adapters remain usable.
                }
            }
            adapterCache = adapters.OrderByDescending(x => IsPrivate(x.Address)).ThenBy(x => x.Info.Name).ToArray();
            adapterReadAt = Stopwatch.GetTimestamp();
            return adapterCache;
        }
    }

    private static bool TryParseIpv4(string? value, out IPAddress address)
    {
        address = IPAddress.None;
        if (string.IsNullOrWhiteSpace(value) || value != value.Trim())
            return false;
        var parts = value.Split('.');
        if (parts.Length != 4 || parts.Any(x => x.Length is < 1 or > 3 ||
            x.Any(character => character is < '0' or > '9') || (x.Length > 1 && x[0] == '0')))
            return false;
        var bytes = new byte[4];
        for (var index = 0; index < 4; index++)
            if (!byte.TryParse(parts[index], NumberStyles.None, CultureInfo.InvariantCulture, out bytes[index]))
                return false;
        address = new IPAddress(bytes);
        return true;
    }

    private static bool IsPrivate(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return bytes.Length == 4 && (bytes[0] == 10 ||
            (bytes[0] == 172 && bytes[1] is >= 16 and <= 31) || (bytes[0] == 192 && bytes[1] == 168));
    }

    private static int MaskPrefix(IPAddress mask)
    {
        var bits = ToUInt32(mask);
        var foundZero = false;
        var count = 0;
        for (var bit = 31; bit >= 0; bit--)
        {
            if ((bits & (1u << bit)) == 0)
                foundZero = true;
            else if (foundZero)
                return -1;
            else
                count++;
        }
        return count;
    }

    private static uint PrefixMask(int prefix) => prefix == 0 ? 0 : uint.MaxValue << (32 - prefix);
    private static uint ToUInt32(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return ((uint)bytes[0] << 24) | ((uint)bytes[1] << 16) | ((uint)bytes[2] << 8) | bytes[3];
    }
    private static IPAddress FromUInt32(uint value) => new(new[] { (byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value });
    private static string FormatMac(byte[] bytes) => string.Join(":", bytes.Select(value => value.ToString("X2", CultureInfo.InvariantCulture)));
    private static string ShortMessage(Exception exception) => (exception.InnerException ?? exception).Message;

    [DllImport("iphlpapi.dll", ExactSpelling = true)]
    private static extern uint SendARP(uint destination, uint source, [Out] byte[] physicalAddress, ref uint physicalAddressLength);

    private sealed record AdapterSnapshot(AdapterInfo Info, IPAddress Address, uint Mask, int Prefix, bool CanArp);
    private sealed record TcpOutcome(PortResult Result, bool Reachable, bool LocalError);
    private sealed record ArpOutcome(string? Mac, bool ActiveResponse, bool Incomplete, string? Error)
    {
        public static readonly ArpOutcome NotApplicable = new(null, false, false, null);
    }
}
