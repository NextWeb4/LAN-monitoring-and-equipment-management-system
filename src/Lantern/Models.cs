namespace Lantern;

public sealed class AppSettings
{
    public string SiteName { get; set; } = "我的办公室";
    public string Subnet { get; set; } = "";
    public int IntervalSeconds { get; set; } = 60;
    public int TimeoutMs { get; set; } = 1000;
    public int PingCount { get; set; } = 3;
    public int[] DefaultPorts { get; set; } = [80, 443];
    public int FailureThreshold { get; set; } = 3;
    public int RecoveryThreshold { get; set; } = 2;
    public double LatencyThresholdMs { get; set; } = 100;
    public double LossThresholdPercent { get; set; } = 20;
    public int RetentionDays { get; set; } = 7;
    public bool MonitoringEnabled { get; set; } = true;
    public bool AutoDiscoveryEnabled { get; set; } = true;
    public int DiscoveryIntervalMinutes { get; set; } = 10;
}

public sealed class Device
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Ip { get; set; } = "";
    public string? Mac { get; set; }
    public string? Hostname { get; set; }
    public string Alias { get; set; } = "";
    public string Type { get; set; } = "device";
    public string Group { get; set; } = "未分组";
    public List<string> Tags { get; set; } = [];
    public string Owner { get; set; } = "";
    public string Location { get; set; } = "";
    public string Notes { get; set; } = "";
    public string Subnet { get; set; } = "";
    public bool MonitoringEnabled { get; set; } = true;
    public int[] Ports { get; set; } = [];
    public string Status { get; set; } = "unknown";
    public int ConsecutiveFailures { get; set; }
    public int ConsecutiveSuccesses { get; set; }
    public DateTimeOffset FirstSeen { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastSeen { get; set; }
    public DateTimeOffset? LastChecked { get; set; }
    public ProbeResult? LastProbe { get; set; }
    public List<AddressChange> AddressHistory { get; set; } = [];
}
public sealed record AddressChange(string Ip, DateTimeOffset ObservedAt);
public sealed record PortResult(int Port, string Status, double? LatencyMs, string? Error = null);
public sealed class ProbeResult
{
    public string Ip { get; set; } = "";
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;
    public int Sent { get; set; }
    public int Received { get; set; }
    public double RttSumMs { get; set; }
    public double? LatencyMs { get; set; }
    public double? LossPercent { get; set; }
    public bool Reachable { get; set; }
    public bool IsComplete { get; set; } = true;
    public string? Error { get; set; }
    public string? Mac { get; set; }
    public string? Hostname { get; set; }
    public List<string> Evidence { get; set; } = [];
    public List<PortResult> Ports { get; set; } = [];
}
public sealed record AdapterInfo(string Id, string Name, string Ip, string Subnet, string? Gateway, string? Mac);
public sealed record HistorySample(string DeviceId, ProbeResult Probe);
public sealed class Incident
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Key { get; set; } = "";
    public string? DeviceId { get; set; }
    public string DeviceName { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Severity { get; set; } = "warning";
    public string Message { get; set; } = "";
    public string Status { get; set; } = "active";
    public bool Acknowledged { get; set; }
    public DateTimeOffset OpenedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ResolvedAt { get; set; }
}
public sealed class ScanJob
{
    public string Status { get; set; } = "idle";
    public string Subnet { get; set; } = "";
    public int Total { get; set; }
    public int Completed { get; set; }
    public int Found { get; set; }
    public string? Error { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
}
public sealed class PersistedState
{
    public int SchemaVersion { get; set; } = 1;
    public AppSettings Settings { get; set; } = new();
    public List<Device> Devices { get; set; } = [];
    public List<Incident> Incidents { get; set; } = [];
}
