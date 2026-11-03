using System.Net;
using System.Text;

namespace Lantern;

public sealed class DeviceManagement(FileStateStore store)
{
    private static readonly HashSet<string> DeviceTypes = new(StringComparer.Ordinal)
    {
        "device", "router", "switch", "server", "computer", "printer", "phone", "camera", "ap", "nas", "other"
    };

    public DeviceBulkUpdateResult UpdateDevices(DeviceBulkUpdateRequest request)
    {
        var ids = request.DeviceIds?.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToArray() ?? [];
        if (ids.Length is < 1 or > 500) throw new ArgumentException("请选择 1–500 台设备进行批量更新。");
        var group = request.Group is null ? null : Text(request.Group, 40, "分组");
        var owner = request.Owner is null ? null : Text(request.Owner, 60, "负责人");
        var location = request.Location is null ? null : Text(request.Location, 80, "位置");
        var tags = request.Tags is null ? null : Tags(request.Tags);
        if (group is null && owner is null && location is null && tags is null && request.MonitoringEnabled is null)
            throw new ArgumentException("请至少填写一项要批量更新的信息。");

        var updated = 0;
        var missing = new List<string>();
        lock (store.Gate)
        {
            foreach (var id in ids)
            {
                var device = store.State.Devices.Find(device => device.Id == id);
                if (device is null) { missing.Add(id); continue; }
                if (group is not null) device.Group = string.IsNullOrWhiteSpace(group) ? "未分组" : group;
                if (owner is not null) device.Owner = owner;
                if (location is not null) device.Location = location;
                if (tags is not null) device.Tags = [.. tags];
                if (request.MonitoringEnabled is { } enabled && enabled != device.MonitoringEnabled)
                {
                    device.MonitoringEnabled = enabled;
                    device.Status = "unknown";
                    device.ConsecutiveFailures = 0;
                    device.ConsecutiveSuccesses = 0;
                }
                updated++;
            }
        }
        return new DeviceBulkUpdateResult(ids.Length, updated, missing);
    }

    public DeviceImportResult ImportDevices(DeviceImportRequest request)
    {
        var input = request.Rows ?? [];
        if (input.Count > 500) throw new ArgumentException("单次最多导入 500 行设备，请分批导入。");
        var rows = new List<DeviceImportRowResult>();
        var accepted = 0;
        lock (store.Gate)
        {
            var existingIps = store.State.Devices.Select(device => device.Ip).ToHashSet(StringComparer.Ordinal);
            var settings = store.State.Settings;
            for (var index = 0; index < input.Count; index++)
            {
                var row = input[index];
                var sourceRow = row.Row is > 0 ? row.Row.Value : index + 2;
                try
                {
                    var ip = NormalizeIp(row.Ip);
                    if (!existingIps.Add(ip)) throw new InvalidOperationException("IP 已存在于设备清单或当前导入文件中。");
                    if (store.State.Devices.Count >= 500) throw new InvalidOperationException("已达到 500 台设备上限。");
                    var type = NormalizeType(row.Type);
                    var group = string.IsNullOrWhiteSpace(row.Group) ? "未分组" : Text(row.Group, 40, "分组");
                    var ports = Ports(row.Ports);
                    var device = new Device
                    {
                        Ip = ip,
                        Alias = Text(row.Alias, 80, "设备名称"),
                        Type = type,
                        Group = group,
                        Tags = Tags(row.Tags),
                        Owner = Text(row.Owner, 60, "负责人"),
                        Location = Text(row.Location, 80, "位置"),
                        Notes = Text(row.Notes, 1000, "备注"),
                        Ports = ports,
                        MonitoringEnabled = row.MonitoringEnabled ?? true,
                        Subnet = SubnetFor(ip, settings.Subnet),
                        AddressHistory = [new(ip, DateTimeOffset.UtcNow)]
                    };
                    store.State.Devices.Add(device);
                    accepted++;
                    rows.Add(new DeviceImportRowResult(sourceRow, ip, "accepted", "已加入设备清单。"));
                }
                catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or FormatException)
                {
                    rows.Add(new DeviceImportRowResult(sourceRow, row.Ip?.Trim() ?? "", "rejected", ex.Message));
                }
            }
        }
        return new DeviceImportResult(input.Count, accepted, rows.Count - accepted, rows);
    }

    public byte[] ExportDevicesCsv()
    {
        var snapshot = store.Snapshot();
        var csv = new StringBuilder();
        csv.AppendLine("IP地址,设备名称,设备类型,分组,标签,负责人,位置,TCP端口,监测启用,MAC地址,主机名称,备注,首次发现");
        foreach (var device in snapshot.Devices.OrderBy(device => device.Group).ThenBy(device => device.Ip, StringComparer.Ordinal))
        {
            var values = new[]
            {
                device.Ip, device.Alias, device.Type, device.Group, string.Join(';', device.Tags ?? []), device.Owner, device.Location,
                string.Join(',', device.Ports), device.MonitoringEnabled ? "是" : "否", device.Mac ?? "", device.Hostname ?? "", device.Notes,
                device.FirstSeen.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss")
            };
            csv.AppendLine(string.Join(',', values.Select(Csv)));
        }
        return Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray();
    }

    public NetworkReport CreateReport(int requestedHours)
    {
        var hours = Math.Clamp(requestedHours, 1, 720);
        var generatedAt = DateTimeOffset.UtcNow;
        var windowStart = generatedAt.AddHours(-hours);
        var state = store.Snapshot();
        var samples = store.LatestHistory().Where(sample => sample.Probe.Timestamp >= windowStart && sample.Probe.IsComplete).ToArray();
        var monitored = state.Devices.Where(device => device.MonitoringEnabled && state.Settings.MonitoringEnabled).ToArray();
        var online = monitored.Count(device => device.Status == "online");
        var offline = monitored.Count(device => device.Status == "offline");
        var unknown = monitored.Length - online - offline;
        var complete = monitored.Where(device => device.LastProbe?.IsComplete == true).ToArray();
        var totalSent = samples.Sum(sample => sample.Probe.Sent);
        var totalReceived = samples.Sum(sample => sample.Probe.Received);
        var totalRtt = samples.Sum(sample => sample.Probe.RttSumMs);
        var portResults = monitored.SelectMany(device => device.LastProbe?.Ports.Where(port => device.Ports.Contains(port.Port)) ?? []).ToArray();
        var activeIncidents = state.Incidents.Where(incident => incident.Status != "resolved").OrderByDescending(incident => incident.UpdatedAt).ToArray();
        var risk = monitored.Select(device => RiskFor(device, state.Settings)).Where(item => item.Reasons.Count > 0)
            .OrderByDescending(item => item.Score).ThenBy(item => item.Name).Take(30).ToArray();
        var groups = state.Devices.GroupBy(device => string.IsNullOrWhiteSpace(device.Group) ? "未分组" : device.Group)
            .OrderBy(group => group.Key).Select(group => new NetworkReportGroup(
                group.Key,
                group.Count(),
                group.Count(device => device.MonitoringEnabled && state.Settings.MonitoringEnabled && device.Status == "online"),
                group.Count(device => device.MonitoringEnabled && state.Settings.MonitoringEnabled && device.Status == "offline"),
                group.Count(device => device.MonitoringEnabled && state.Settings.MonitoringEnabled && device.Status == "unknown"))).ToArray();
        var recommendations = Recommendations(state.Settings, monitored, samples, offline, unknown, activeIncidents, portResults);
        DateTimeOffset? earliest = samples.Length == 0 ? null : samples.Min(sample => sample.Probe.Timestamp);
        DateTimeOffset? latest = samples.Length == 0 ? null : samples.Max(sample => sample.Probe.Timestamp);
        return new NetworkReport(
            generatedAt, hours, windowStart, earliest, latest, state.Devices.Count, monitored.Length,
            state.Devices.Count(device => !device.MonitoringEnabled) + (state.Settings.MonitoringEnabled ? 0 : state.Devices.Count),
            online, offline, unknown, monitored.Length == 0 ? null : 100d * online / monitored.Length,
            complete.Length, totalReceived > 0 ? totalRtt / totalReceived : null, totalSent > 0 ? 100d * (totalSent - totalReceived) / totalSent : null,
            samples.Length, totalSent, totalReceived, portResults.Length, portResults.Count(port => port.Status == "open"),
            portResults.Count(port => port.Status is "closed" or "timeout"), activeIncidents.Length,
            activeIncidents.Count(incident => !incident.Acknowledged), groups, risk, recommendations,
            activeIncidents.Take(12).Select(incident => new NetworkReportIncident(incident.Id, incident.DeviceName, incident.Kind, incident.Severity, incident.Message, incident.Acknowledged, incident.OpenedAt, incident.UpdatedAt)).ToArray());
    }

    private static NetworkReportRisk RiskFor(Device device, AppSettings settings)
    {
        var reasons = new List<string>();
        var score = 0;
        if (device.Status == "offline") { reasons.Add("当前离线"); score += 100; }
        else if (device.Status == "unknown") { reasons.Add("等待有效采样"); score += 20; }
        var probe = device.LastProbe;
        if (probe?.IsComplete == true && probe.LossPercent >= settings.LossThresholdPercent) { reasons.Add($"丢包 {probe.LossPercent:F1}%"); score += 40; }
        if (probe?.IsComplete == true && probe.LatencyMs >= settings.LatencyThresholdMs) { reasons.Add($"延迟 {probe.LatencyMs:F1} ms"); score += 25; }
        var failedPorts = probe?.Ports.Where(port => device.Ports.Contains(port.Port) && port.Status is "closed" or "timeout").ToArray() ?? [];
        if (failedPorts.Length > 0) { reasons.Add($"{failedPorts.Length} 个 TCP 端口异常"); score += failedPorts.Length * 15; }
        return new NetworkReportRisk(device.Id, DeviceName(device), device.Ip, device.Group, device.Status, score, reasons, probe?.LatencyMs, probe?.LossPercent, failedPorts.Select(port => port.Port).ToArray());
    }

    private static string[] Recommendations(AppSettings settings, Device[] monitored, HistorySample[] samples, int offline, int unknown, Incident[] active, PortResult[] ports)
    {
        var suggestions = new List<string>();
        if (!settings.MonitoringEnabled) suggestions.Add("自动监测已暂停；恢复后才能形成新的状态与告警记录。");
        if (monitored.Length == 0) suggestions.Add("尚无正在监测的设备；可先发现局域网设备或导入已有清单。");
        if (samples.Length == 0 && monitored.Length > 0) suggestions.Add("当前报告期没有完整采样；请执行一次监测并保持后台程序运行。");
        if (offline > 0) suggestions.Add($"有 {offline} 台设备处于离线状态，建议先核对供电、网络连接与目标地址。");
        if (unknown > 0) suggestions.Add($"有 {unknown} 台设备等待有效采样；可查看最近检查时间和监测是否被暂停。");
        if (ports.Any(port => port.Status is "closed" or "timeout")) suggestions.Add("存在配置端口不可达；请确认服务是否运行、防火墙规则和端口配置。");
        if (active.Any(incident => !incident.Acknowledged)) suggestions.Add("未确认的活动告警仍在列表中，处理后可在异常提醒页面确认。");
        if (suggestions.Count == 0 && monitored.Length > 0) suggestions.Add("当前采样未显示需要立即处理的设备异常；请继续保持周期监测以累积趋势。 ");
        return suggestions.Take(6).ToArray();
    }

    private static string DeviceName(Device device) => string.IsNullOrWhiteSpace(device.Alias) ? device.Hostname ?? device.Ip : device.Alias;
    private static string NormalizeIp(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || !NetworkProbe.IsAllowedIp(value.Trim())) throw new ArgumentException("请输入局域网 IPv4 地址。 ");
        return IPAddress.Parse(value.Trim()).ToString();
    }
    private static string NormalizeType(string? value) => string.IsNullOrWhiteSpace(value) ? "device" : DeviceTypes.Contains(value.Trim()) ? value.Trim() : throw new ArgumentException("设备类型不受支持。 ");
    private static string Text(string? value, int limit, string field)
    {
        var text = value?.Trim() ?? "";
        if (text.Length > limit) throw new ArgumentException($"{field}最长 {limit} 字符。 ");
        return text;
    }
    private static List<string> Tags(IEnumerable<string>? source)
    {
        var tags = source?.Select(tag => Text(tag, 24, "标签")).Where(tag => tag.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList() ?? [];
        if (tags.Count > 12) throw new ArgumentException("每台设备最多使用 12 个标签。 ");
        return tags;
    }
    private static int[] Ports(IEnumerable<int>? source)
    {
        var ports = source?.Distinct().Order().ToArray() ?? [];
        if (ports.Length > 16 || ports.Any(port => port is < 1 or > 65535)) throw new ArgumentException("最多配置 16 个 TCP 端口，范围为 1–65535。 ");
        return ports;
    }
    private static string SubnetFor(string ip, string subnet)
    {
        if (!string.IsNullOrWhiteSpace(subnet))
        {
            try { if (NetworkProbe.ExpandSubnet(subnet).Contains(ip)) return subnet; }
            catch (ArgumentException) { /* Settings are already validated before storage. */ }
        }
        return ip + "/32";
    }
    private static string Csv(string? value)
    {
        var text = value ?? "";
        return text.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? $"\"{text.Replace("\"", "\"\"")}\"" : text;
    }
}

public sealed class DeviceBulkUpdateRequest
{
    public List<string>? DeviceIds { get; set; }
    public string? Group { get; set; }
    public List<string>? Tags { get; set; }
    public string? Owner { get; set; }
    public string? Location { get; set; }
    public bool? MonitoringEnabled { get; set; }
}

public sealed class DeviceImportRequest { public List<DeviceImportRow>? Rows { get; set; } }
public sealed class DeviceImportRow
{
    public int? Row { get; set; }
    public string? Ip { get; set; }
    public string? Alias { get; set; }
    public string? Type { get; set; }
    public string? Group { get; set; }
    public List<string>? Tags { get; set; }
    public string? Owner { get; set; }
    public string? Location { get; set; }
    public List<int>? Ports { get; set; }
    public bool? MonitoringEnabled { get; set; }
    public string? Notes { get; set; }
}
public sealed record DeviceBulkUpdateResult(int Requested, int Updated, List<string> MissingIds);
public sealed record DeviceImportRowResult(int Row, string Ip, string Status, string Message);
public sealed record DeviceImportResult(int Received, int Accepted, int Rejected, List<DeviceImportRowResult> Rows);
public sealed record NetworkReportGroup(string Name, int Devices, int Online, int Offline, int Unknown);
public sealed record NetworkReportRisk(string DeviceId, string Name, string Ip, string Group, string Status, int Score, List<string> Reasons, double? LatencyMs, double? LossPercent, int[] FailedPorts);
public sealed record NetworkReportIncident(string Id, string DeviceName, string Kind, string Severity, string Message, bool Acknowledged, DateTimeOffset OpenedAt, DateTimeOffset UpdatedAt);
public sealed record NetworkReport(
    DateTimeOffset GeneratedAt, int RequestedHours, DateTimeOffset WindowStart, DateTimeOffset? SamplesFrom, DateTimeOffset? SamplesTo,
    int TotalDevices, int MonitoredDevices, int PausedDevices, int OnlineDevices, int OfflineDevices, int UnknownDevices, double? OnlineRate,
    int CompleteDeviceProbes, double? AverageLatencyMs, double? LossPercent, int Samples, int SentPackets, int ReceivedPackets,
    int CheckedPorts, int OpenPorts, int UnavailablePorts, int ActiveIncidents, int UnacknowledgedIncidents,
    NetworkReportGroup[] Groups, NetworkReportRisk[] AtRiskDevices, string[] Recommendations, NetworkReportIncident[] RecentIncidents);
