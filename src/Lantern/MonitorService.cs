using System.Collections.Concurrent;

namespace Lantern;

public sealed class MonitorService(FileStateStore store, NetworkProbe network, ILogger<MonitorService> logger) : BackgroundService
{
    private readonly SemaphoreSlim _probeGate = new(1, 1);
    private readonly Dictionary<string, int> _ruleFailures = [];
    private readonly Dictionary<string, int> _ruleSuccesses = [];
    private CancellationTokenSource? _scanCancellation;
    private Task? _scanTask;
    private CancellationToken _stoppingToken;
    private ScanJob _scan = new();
    private DateTimeOffset? _lastCycleAt;
    private DateTimeOffset? _lastDiscoveryAt;
    private string? _error;
    private string _status = "starting";

    public object View()
    {
        var state = store.Snapshot();
        var now = DateTimeOffset.UtcNow;
        foreach (var device in state.Devices)
            if (!device.MonitoringEnabled || device.LastChecked is null || now - device.LastChecked > TimeSpan.FromSeconds(state.Settings.IntervalSeconds * 3 + 15))
                device.Status = "unknown";
        ScanJob scan;
        object collector;
        lock (store.Gate)
        {
            scan = FileStateStore.Clone(_scan);
            collector = new { status = state.Settings.MonitoringEnabled ? _status : "paused", lastCycleAt = _lastCycleAt, error = _error ?? store.StorageError };
        }
        IReadOnlyList<AdapterInfo> adapters;
        try { adapters = network.GetAdapters(); }
        catch (Exception ex) { adapters = []; logger.LogWarning(ex, "网卡信息不可用"); }
        return new { state.Settings, state.Devices, state.Incidents, scan, collector, adapters, history = store.LatestHistory(), storage = new { mode = "json-files", retentionDays = state.Settings.RetentionDays }, now };
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _stoppingToken = stoppingToken;
        lock (store.Gate) _status = "idle";
        try
        {
            await Task.Delay(1500, stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                var settings = store.Snapshot().Settings;
                if (settings.MonitoringEnabled)
                {
                    await ProbeOnceAsync(stoppingToken);
                    bool discoveryDue;
                    lock (store.Gate) discoveryDue = _scan.Status != "running" && (_lastDiscoveryAt is null || DateTimeOffset.UtcNow - _lastDiscoveryAt >= TimeSpan.FromMinutes(settings.DiscoveryIntervalMinutes));
                    if (settings.AutoDiscoveryEnabled && !string.IsNullOrWhiteSpace(settings.Subnet) && discoveryDue)
                    {
                        try { await StartScanAsync(settings.Subnet); }
                        catch (InvalidOperationException) { /* A user action acquired the probe gate first. */ }
                    }
                }
                await Task.Delay(TimeSpan.FromSeconds(settings.IntervalSeconds), stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    public async Task<bool> ProbeOnceAsync(CancellationToken cancellationToken)
    {
        if (!await _probeGate.WaitAsync(0, cancellationToken)) return false;
        try
        {
            var state = store.Snapshot();
            lock (store.Gate)
            {
                _status = "monitoring";
                if (_lastCycleAt is not null && DateTimeOffset.UtcNow - _lastCycleAt > TimeSpan.FromSeconds(state.Settings.IntervalSeconds * 3 + 30))
                {
                    foreach (var device in store.State.Devices)
                    {
                        device.Status = "unknown";
                        device.ConsecutiveFailures = device.ConsecutiveSuccesses = 0;
                    }
                    _ruleFailures.Clear(); _ruleSuccesses.Clear();
                }
            }
            var samples = new ConcurrentBag<HistorySample>();
            var devices = state.Devices.Where(x => x.MonitoringEnabled).ToList();
            await Parallel.ForEachAsync(devices, new ParallelOptions { MaxDegreeOfParallelism = 24, CancellationToken = cancellationToken }, async (device, token) =>
            {
                var result = await network.ProbeAsync(device.Ip, device.Ports, state.Settings.PingCount, state.Settings.TimeoutMs, false, token);
                lock (store.Gate)
                {
                    var current = store.State.Devices.Find(x => x.Id == device.Id);
                    if (current is null || !current.MonitoringEnabled || current.Ip != result.Ip) return;
                    if (current.Mac is not null && result.Mac is not null && !current.Mac.Equals(result.Mac, StringComparison.OrdinalIgnoreCase))
                    {
                        current.MonitoringEnabled = false;
                        current.Status = "unknown";
                        Raise($"identity:{current.Id}", current, "identity", "warning", $"{current.Ip} 的 MAC 已变化，旧设备监测已暂停，请核对身份。", result.Timestamp);
                        var replacement = Register(result, current.Subnet, state.Settings);
                        if (replacement is not null) { Apply(replacement, result, state.Settings); samples.Add(new(replacement.Id, result)); }
                        return;
                    }
                    Apply(current, result, state.Settings);
                    samples.Add(new(current.Id, result));
                }
            });
            await store.AppendHistoryAsync(samples.OrderBy(x => x.Probe.Timestamp).ToArray());
            await store.SaveAsync();
            await store.PruneAsync();
            lock (store.Gate) { _lastCycleAt = DateTimeOffset.UtcNow; _status = "idle"; _error = null; }
            return true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return false; }
        catch (Exception ex)
        {
            logger.LogError(ex, "本轮采集未完成");
            lock (store.Gate)
            {
                _error = "采集或存储失败：" + ex.Message;
                _status = "error";
            }
            return false;
        }
        finally
        {
            lock (store.Gate) if (_status == "monitoring") _status = "idle";
            _probeGate.Release();
        }
    }

    public async Task<ScanJob> StartScanAsync(string subnet)
    {
        var targets = NetworkProbe.ExpandSubnet(subnet);
        if (!await _probeGate.WaitAsync(0)) throw new InvalidOperationException("已有发现或监测任务正在执行，请稍后重试。");
        AppSettings settings;
        CancellationToken token;
        ScanJob response;
        lock (store.Gate)
        {
            settings = FileStateStore.Clone(store.State.Settings);
            _scanCancellation?.Dispose();
            _scanCancellation = CancellationTokenSource.CreateLinkedTokenSource(_stoppingToken);
            token = _scanCancellation.Token;
            _scan = new() { Status = "running", Subnet = subnet, Total = targets.Length, StartedAt = DateTimeOffset.UtcNow };
            _status = "discovering";
            _lastDiscoveryAt = DateTimeOffset.UtcNow;
            response = FileStateStore.Clone(_scan);
        }
        _scanTask = Task.Run(async () =>
        {
            var samples = new ConcurrentBag<HistorySample>();
            try
            {
                await Parallel.ForEachAsync(targets, new ParallelOptions { MaxDegreeOfParallelism = 24, CancellationToken = token }, async (ip, ct) =>
                {
                    var result = await network.ProbeAsync(ip, settings.DefaultPorts, 1, settings.TimeoutMs, true, ct);
                    lock (store.Gate)
                    {
                        _scan.Completed++;
                        if (!result.Reachable) return;
                        _scan.Found++;
                        var device = Register(result, subnet, settings);
                        if (device is { MonitoringEnabled: true })
                        {
                            Apply(device, result, settings);
                            samples.Add(new(device.Id, result));
                        }
                        else if (device is null)
                            _scan.Error = "首版最多管理 500 台设备，超出的设备未加入台账。";
                    }
                });
                lock (store.Gate) _scan.Status = "completed";
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { lock (store.Gate) _scan.Status = "cancelled"; }
            catch (Exception ex)
            {
                logger.LogError(ex, "设备发现失败");
                lock (store.Gate) { _scan.Status = "failed"; _scan.Error = ex.Message; }
            }
            finally
            {
                try
                {
                    await store.AppendHistoryAsync(samples.OrderBy(x => x.Probe.Timestamp).ToArray());
                    await store.SaveAsync();
                    await store.PruneAsync();
                }
                catch (Exception ex) { lock (store.Gate) { _scan.Status = "failed"; _scan.Error = "发现结果保存失败：" + ex.Message; } }
                lock (store.Gate) { _scan.FinishedAt = DateTimeOffset.UtcNow; _status = "idle"; }
                _probeGate.Release();
            }
        }, CancellationToken.None);
        return response;
    }

    public void CancelScan() { lock (store.Gate) _scanCancellation?.Cancel(); }

    private Device? Register(ProbeResult probe, string subnet, AppSettings settings)
    {
        var state = store.State;
        // Private address ranges can overlap across VLANs or VPNs. Match IP identity only
        // within the subnet being discovered; MAC matches are scoped the same way below.
        var subnetDevices = state.Devices.Where(x => x.Subnet == subnet).ToList();
        var byIp = subnetDevices.Find(x => x.Ip == probe.Ip && x.MonitoringEnabled);
        var existingByIp = subnetDevices.Find(x => x.Ip == probe.Ip);
        var byMac = probe.Mac is null ? null : state.Devices.Find(x => x.Subnet == subnet && string.Equals(x.Mac, probe.Mac, StringComparison.OrdinalIgnoreCase));
        // A MAC seen at two addresses in the same discovery window is ambiguous (proxy ARP,
        // multi-address interfaces, or duplicates). Never silently merge those identities.
        if (byMac is not null && byMac.Ip != probe.Ip && byMac.LastSeen is { } seen && probe.Timestamp - seen < TimeSpan.FromSeconds(settings.IntervalSeconds * 3))
        {
            Raise($"duplicate-mac:{byMac.Id}", byMac, "identity", "warning", $"MAC {probe.Mac} 同时出现在不同 IP，请人工核对设备身份。", probe.Timestamp);
            byMac = null;
        }
        if (byMac is not null && byIp is not null && byMac.Id != byIp.Id)
        {
            Raise($"duplicate-mac:{byMac.Id}", byMac, "identity", "warning", $"MAC {probe.Mac} 同时关联到 {byMac.Ip} 和 {probe.Ip}，请人工核对设备身份。", probe.Timestamp);
            byMac = null;
        }
        if (byIp is not null && probe.Mac is not null && byIp.Mac is not null && !probe.Mac.Equals(byIp.Mac, StringComparison.OrdinalIgnoreCase))
        {
            byIp.MonitoringEnabled = false;
            byIp.Status = "unknown";
            Raise($"identity:{byIp.Id}", byIp, "identity", "warning", $"{byIp.Ip} 的 MAC 已变化，旧设备监测已暂停。", probe.Timestamp);
            byIp = null;
        }
        var device = byMac ?? byIp;
        if (device is null && existingByIp is not null)
        {
            // A paused record with no conflicting identity remains paused. A confirmed MAC
            // change keeps the old record and continues through replacement registration.
            if (existingByIp.Mac is null || probe.Mac is null || existingByIp.Mac.Equals(probe.Mac, StringComparison.OrdinalIgnoreCase))
                return existingByIp;
            Raise($"identity:{existingByIp.Id}", existingByIp, "identity", "warning",
                $"{existingByIp.Ip} 的 MAC 已变化，旧设备监测仍保持暂停。", probe.Timestamp);
        }
        if (device is null)
        {
            if (state.Devices.Count >= 500) return null;
            device = new Device { Ip = probe.Ip, Hostname = probe.Hostname, Subnet = subnet, Ports = probe.Ports.Where(x => x.Status == "open").Select(x => x.Port).ToArray() };
            device.AddressHistory.Add(new(probe.Ip, probe.Timestamp));
            state.Devices.Add(device);
            Raise($"new-device:{device.Id}", device, "new-device", "info", $"发现新设备 {probe.Hostname ?? probe.Ip}。", probe.Timestamp);
        }
        else if (!device.MonitoringEnabled)
        {
            // Discovery can identify a paused device, but must not change its IP, status,
            // counters, port incidents, or user configuration.
            return device;
        }
        else if (device.Ip != probe.Ip)
        {
            device.Ip = probe.Ip;
            device.AddressHistory.Add(new(probe.Ip, probe.Timestamp));
            device.AddressHistory = device.AddressHistory.TakeLast(50).ToList();
        }
        if (probe.Mac is not null)
        {
            var macOwner = state.Devices.Find(x => x.Id != device!.Id && x.Subnet == subnet &&
                string.Equals(x.Mac, probe.Mac, StringComparison.OrdinalIgnoreCase));
            if (macOwner is null)
                device.Mac = probe.Mac;
            else
                Raise($"duplicate-mac:{macOwner.Id}", macOwner, "identity", "warning",
                    $"MAC {probe.Mac} 同时关联到 {macOwner.Ip} 和 {probe.Ip}，请人工核对设备身份。", probe.Timestamp);
        }
        device.Hostname = probe.Hostname ?? device.Hostname;
        return device;
    }

    private void Apply(Device device, ProbeResult result, AppSettings settings)
    {
        if (device.LastChecked is not null && device.LastChecked > result.Timestamp) return;
        device.LastChecked = result.Timestamp;
        device.LastProbe = result;
        if (result.Mac is not null)
        {
            var macOwner = store.State.Devices.Find(x => x.Id != device.Id && x.Subnet == device.Subnet &&
                string.Equals(x.Mac, result.Mac, StringComparison.OrdinalIgnoreCase));
            if (macOwner is null)
                device.Mac = result.Mac;
            else
                Raise($"duplicate-mac:{macOwner.Id}", macOwner, "identity", "warning",
                    $"MAC {result.Mac} 同时关联到 {macOwner.Ip} 和 {device.Ip}，请人工核对设备身份。", result.Timestamp);
        }
        if (result.Reachable)
        {
            device.LastSeen = result.Timestamp;
            device.ConsecutiveSuccesses++;
            device.ConsecutiveFailures = 0;
            device.Status = "online";
            if (device.ConsecutiveSuccesses >= settings.RecoveryThreshold) Resolve($"offline:{device.Id}", result.Timestamp);
        }
        else if (result.IsComplete)
        {
            device.ConsecutiveSuccesses = 0;
            device.ConsecutiveFailures++;
            device.Status = device.ConsecutiveFailures >= settings.FailureThreshold ? "offline" : "unknown";
            if (device.Status == "offline") Raise($"offline:{device.Id}", device, "offline", "critical", $"连续 {device.ConsecutiveFailures} 轮未获得在线响应。", result.Timestamp);
        }
        else
        {
            device.Status = "unknown";
            device.ConsecutiveFailures = device.ConsecutiveSuccesses = 0;
        }
        if (!result.IsComplete) return;
        if (device.Status != "offline")
        {
            foreach (var port in result.Ports.Where(p => device.Ports.Contains(p.Port)))
            {
                if (port.Status == "error") continue;
                CheckRule($"port:{device.Id}:{port.Port}", port.Status != "open", settings.FailureThreshold, settings.RecoveryThreshold,
                    device, "port", $"TCP {port.Port} 连续探测异常（{(port.Status == "closed" ? "连接被拒绝" : "连接超时")}）。", result.Timestamp);
            }
            var window = store.History(device.Id).Select(x => x.Probe).Append(result)
                .Where(x => x.Timestamp >= result.Timestamp.AddMinutes(-5) && x.IsComplete && x.Sent > 0).ToArray();
            var sent = window.Sum(x => x.Sent);
            var received = window.Sum(x => x.Received);
            if (window.Length >= 4 && sent >= 12)
            {
                var loss = 100d * (sent - received) / sent;
                CheckRule($"loss:{device.Id}", loss >= settings.LossThresholdPercent, 1, settings.RecoveryThreshold,
                    device, "loss", $"近 5 分钟丢包率 {loss:F1}%（{sent} 个发送样本）。", result.Timestamp);
                if (received > 0)
                {
                    var latency = window.Sum(x => x.RttSumMs) / received;
                    CheckRule($"latency:{device.Id}", latency >= settings.LatencyThresholdMs, 1, settings.RecoveryThreshold,
                        device, "latency", $"近 5 分钟平均延迟 {latency:F1} ms。", result.Timestamp);
                }
            }
        }
        // Bound persisted events; unresolved incidents are never silently discarded.
        var remove = store.State.Incidents.Where(x => x.Status == "resolved").OrderByDescending(x => x.UpdatedAt).Skip(1000).ToHashSet();
        store.State.Incidents.RemoveAll(remove.Contains);
    }

    private void CheckRule(string key, bool failing, int failures, int recoveries, Device device, string kind, string message, DateTimeOffset now)
    {
        if (failing)
        {
            _ruleSuccesses[key] = 0;
            _ruleFailures[key] = _ruleFailures.GetValueOrDefault(key) + 1;
            if (_ruleFailures[key] >= failures) Raise(key, device, kind, "warning", message, now);
        }
        else
        {
            _ruleFailures[key] = 0;
            _ruleSuccesses[key] = _ruleSuccesses.GetValueOrDefault(key) + 1;
            if (_ruleSuccesses[key] >= recoveries) Resolve(key, now);
        }
    }
    private void Raise(string key, Device device, string kind, string severity, string message, DateTimeOffset now)
    {
        var existing = store.State.Incidents.Find(x => x.Key == key && x.Status == "active");
        if (existing is not null) { existing.UpdatedAt = now; existing.Message = message; return; }
        store.State.Incidents.Insert(0, new Incident { Key = key, DeviceId = device.Id, DeviceName = string.IsNullOrWhiteSpace(device.Alias) ? device.Hostname ?? device.Ip : device.Alias, Kind = kind, Severity = severity, Message = message, OpenedAt = now, UpdatedAt = now });
    }
    private void Resolve(string key, DateTimeOffset now)
    {
        foreach (var incident in store.State.Incidents.Where(x => x.Key == key && x.Status == "active"))
        { incident.Status = "resolved"; incident.ResolvedAt = now; incident.UpdatedAt = now; }
    }
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        CancelScan();
        await base.StopAsync(cancellationToken);
        if (_scanTask is not null) try { await _scanTask.WaitAsync(cancellationToken); } catch (OperationCanceledException) { }
    }
}
