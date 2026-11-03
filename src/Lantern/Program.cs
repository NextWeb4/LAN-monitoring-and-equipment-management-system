using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Lantern;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
    WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")
});
builder.WebHost.UseUrls("http://127.0.0.1:5188");
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 64 * 1024);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);
builder.Services.AddSingleton<FileStateStore>();
builder.Services.AddSingleton<NetworkProbe>();
builder.Services.AddSingleton<DeviceManagement>();
builder.Services.AddSingleton<MonitorService>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<MonitorService>());
var app = builder.Build();
var csrfToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
var stateStore = app.Services.GetRequiredService<FileStateStore>();
ValidateSettings(stateStore.Snapshot().Settings);
if (!File.Exists(Path.Combine(stateStore.DataDirectory, "state.json"))) await stateStore.SaveAsync();

app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "same-origin";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'";
    if (context.Request.Host.Host is not ("127.0.0.1" or "localhost"))
    {
        context.Response.StatusCode = 403;
        await context.Response.WriteAsJsonAsync(new { error = "首版仅允许本机访问。" });
        return;
    }
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.Headers.CacheControl = "no-store";
        if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
        {
            var supplied = context.Request.Headers["X-Lantern-Token"].ToString();
            var origin = context.Request.Headers.Origin.ToString();
            if (supplied != csrfToken || (!string.IsNullOrEmpty(origin) && origin != $"{context.Request.Scheme}://{context.Request.Host}"))
            {
                context.Response.StatusCode = 403;
                await context.Response.WriteAsJsonAsync(new { error = "页面会话已更新，请刷新后重试。" });
                return;
            }
        }
    }
    try { await next(); }
    catch (ArgumentException ex) { await Error(context, 400, ex.Message); }
    catch (InvalidOperationException ex) { await Error(context, 409, ex.Message); }
    catch (BadHttpRequestException) { await Error(context, 400, "请求格式不正确或内容过大。"); }
    catch (JsonException) { await Error(context, 400, "JSON 格式不正确。"); }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "请求处理失败");
        await Error(context, 500, "操作未完成，请检查程序日志、数据目录和磁盘空间。");
    }
});

app.MapGet("/api/bootstrap", () => new { csrfToken });
app.MapGet("/api/state", (MonitorService monitor) => monitor.View());
app.MapGet("/api/devices/{id}/history", (string id, FileStateStore store) => Results.Ok(store.History(id)));
app.MapPost("/api/scan", async (ScanRequest request, MonitorService monitor) =>
{
    var subnet = NormalizeSubnet(request.Subnet);
    return Results.Accepted("/api/state", await monitor.StartScanAsync(subnet));
});
app.MapPost("/api/scan/cancel", (MonitorService monitor) => { monitor.CancelScan(); return Results.Ok(new { ok = true }); });
app.MapPost("/api/probe", async (MonitorService monitor) => await monitor.ProbeOnceAsync(app.Lifetime.ApplicationStopping)
    ? Results.Ok(new { ok = true }) : Results.Conflict(new { error = "任务繁忙或采集未完成，请查看采集状态。" }));
app.MapPut("/api/settings", async (AppSettings request, FileStateStore store) =>
{
    ValidateSettings(request);
    request.DefaultPorts = Ports(request.DefaultPorts);
    request.SiteName = Text(request.SiteName, 60, "站点名称");
    if (!string.IsNullOrWhiteSpace(request.Subnet)) request.Subnet = NormalizeSubnet(request.Subnet);
    else request.Subnet = "";
    lock (store.Gate) store.State.Settings = request;
    await store.SaveAsync();
    await store.PruneAsync();
    return Results.Ok(request);
});
app.MapPost("/api/devices", async (AddDeviceRequest request, FileStateStore store) =>
{
    if (string.IsNullOrWhiteSpace(request.Ip) || !NetworkProbe.IsAllowedIp(request.Ip)) throw new ArgumentException("请输入局域网 IPv4 地址（或本机 127.0.0.1）。");
    var ip = IPAddress.Parse(request.Ip).ToString();
    var device = new Device
    {
        Ip = ip,
        Alias = Text(request.Alias, 80, "别名"),
        Type = DeviceType(request.Type),
        Group = string.IsNullOrWhiteSpace(request.Group) ? "未分组" : Text(request.Group, 40, "分组"),
        Tags = Tags(request.Tags),
        Owner = Text(request.Owner, 60, "负责人"),
        Location = Text(request.Location, 80, "位置"),
        Ports = Ports(request.Ports),
        AddressHistory = [new(ip, DateTimeOffset.UtcNow)]
    };
    lock (store.Gate)
    {
        if (store.State.Devices.Count >= 500) throw new InvalidOperationException("首版最多管理 500 台设备。");
        if (store.State.Devices.Any(x => x.Ip == ip)) throw new InvalidOperationException("该 IP 已在设备清单中，包括已暂停设备；请编辑或重新启用原记录。");
        var subnet = store.State.Settings.Subnet;
        device.Subnet = !string.IsNullOrEmpty(subnet) && NetworkProbe.ExpandSubnet(subnet).Contains(ip) ? subnet : ip + "/32";
        store.State.Devices.Add(device);
    }
    await store.SaveAsync();
    return Results.Created($"/api/devices/{device.Id}", device);
});
app.MapPatch("/api/devices/{id}", async (string id, EditDeviceRequest request, FileStateStore store) =>
{
    Device? device;
    // Validate before changing any state, so invalid forms cannot partly update a device.
    var alias = request.Alias is null ? null : Text(request.Alias, 80, "别名");
    var type = request.Type is null ? null : DeviceType(request.Type);
    var group = request.Group is null ? null : Text(request.Group, 40, "分组");
    var tags = request.Tags is null ? null : Tags(request.Tags);
    var owner = request.Owner is null ? null : Text(request.Owner, 60, "负责人");
    var location = request.Location is null ? null : Text(request.Location, 80, "位置");
    var notes = request.Notes is null ? null : Text(request.Notes, 1000, "备注");
    var ports = request.Ports is null ? null : Ports(request.Ports);
    lock (store.Gate)
    {
        device = store.State.Devices.Find(x => x.Id == id);
        if (device is null) return Results.NotFound(new { error = "设备不存在。" });
        if (request.MonitoringEnabled == true && store.State.Devices.Any(x => x.Id != id && x.Ip == device.Ip && x.MonitoringEnabled))
            throw new InvalidOperationException("同一 IP 已有另一台监测中的设备，请先核对身份。");
        device.Alias = alias ?? device.Alias;
        device.Type = type ?? device.Type;
        device.Group = group is null ? device.Group : (string.IsNullOrWhiteSpace(group) ? "未分组" : group);
        device.Tags = tags ?? device.Tags;
        device.Owner = owner ?? device.Owner;
        device.Location = location ?? device.Location;
        device.Notes = notes ?? device.Notes;
        if (ports is not null)
        {
            device.Ports = ports;
            foreach (var incident in store.State.Incidents.Where(x => x.DeviceId == id && x.Kind == "port" && x.Status == "active"))
                if (!ports.Any(p => incident.Key == $"port:{id}:{p}"))
                { incident.Status = "resolved"; incident.ResolvedAt = DateTimeOffset.UtcNow; incident.UpdatedAt = DateTimeOffset.UtcNow; }
        }
        if (request.MonitoringEnabled is { } enabled && enabled != device.MonitoringEnabled)
        {
            device.MonitoringEnabled = enabled;
            device.Status = "unknown";
            device.ConsecutiveFailures = device.ConsecutiveSuccesses = 0;
        }
    }
    await store.SaveAsync();
    return Results.Ok(device);
});
app.MapDelete("/api/devices/{id}", async (string id, FileStateStore store) =>
{
    lock (store.Gate)
    {
        if (store.State.Devices.RemoveAll(x => x.Id == id) == 0) return Results.NotFound(new { error = "设备不存在。" });
        // Keep resolved events as an audit trail after removal; no new probes are scheduled.
        foreach (var incident in store.State.Incidents.Where(x => x.DeviceId == id && x.Status == "active"))
        { incident.Status = "resolved"; incident.ResolvedAt = DateTimeOffset.UtcNow; incident.UpdatedAt = DateTimeOffset.UtcNow; }
        store.ForgetHistory(id);
    }
    await store.SaveAsync();
    return Results.Ok(new { ok = true });
});
app.MapPatch("/api/devices/batch", async (DeviceBulkUpdateRequest request, DeviceManagement management, FileStateStore store) =>
{
    var result = management.UpdateDevices(request);
    if (result.Updated > 0) await store.SaveAsync();
    return Results.Ok(result);
});
app.MapPost("/api/devices/import", async (DeviceImportRequest request, DeviceManagement management, FileStateStore store) =>
{
    var result = management.ImportDevices(request);
    if (result.Accepted > 0) await store.SaveAsync();
    return Results.Ok(result);
});
app.MapGet("/api/devices/export.csv", (DeviceManagement management) =>
    Results.File(management.ExportDevicesCsv(), "text/csv; charset=utf-8", $"lantern-devices-{DateTime.Now:yyyyMMdd-HHmm}.csv"));
app.MapGet("/api/report", (int? hours, DeviceManagement management) => Results.Ok(management.CreateReport(hours ?? 24)));
app.MapPost("/api/incidents/{id}/ack", async (string id, FileStateStore store) =>
{
    lock (store.Gate)
    {
        var incident = store.State.Incidents.Find(x => x.Id == id);
        if (incident is null) return Results.NotFound(new { error = "事件不存在。" });
        incident.Acknowledged = true;
        incident.UpdatedAt = DateTimeOffset.UtcNow;
        if (incident.Kind == "new-device") { incident.Status = "resolved"; incident.ResolvedAt = DateTimeOffset.UtcNow; }
    }
    await store.SaveAsync();
    return Results.Ok(new { ok = true });
});
app.MapGet("/api/export", (FileStateStore store) => Results.File(JsonSerializer.SerializeToUtf8Bytes(store.Snapshot(), new JsonSerializerOptions(FileStateStore.Json) { WriteIndented = true }), "application/json", $"lantern-{DateTime.Now:yyyyMMdd-HHmm}.json"));
app.Map("/api/{**path}", () => Results.NotFound(new { error = "接口不存在。" }));
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");
app.Logger.LogInformation("LANtern 本机工作台 http://127.0.0.1:5188，数据目录 {DataDirectory}", stateStore.DataDirectory);
await app.RunAsync();

static async Task Error(HttpContext context, int code, string message)
{
    if (context.Response.HasStarted) return;
    context.Response.StatusCode = code;
    await context.Response.WriteAsJsonAsync(new { error = message });
}
static string Text(string? value, int limit, string field)
{
    var text = value?.Trim() ?? "";
    if (text.Length > limit) throw new ArgumentException($"{field}最长 {limit} 字符。");
    return text;
}
static string DeviceType(string? type)
{
    var allowed = new[] { "device", "router", "switch", "server", "computer", "printer", "phone", "camera", "ap", "nas", "other" };
    return string.IsNullOrWhiteSpace(type) ? "device" : allowed.Contains(type) ? type : throw new ArgumentException("设备类型不受支持。");
}
static int[] Ports(int[]? ports)
{
    if (ports is null) return [];
    if (ports.Length > 16 || ports.Any(x => x is < 1 or > 65535)) throw new ArgumentException("最多配置 16 个 TCP 端口，范围为 1–65535。");
    return ports.Distinct().Order().ToArray();
}
static List<string> Tags(IEnumerable<string>? tags)
{
    if (tags is null) return [];
    var cleaned = tags.Select(x => Text(x, 24, "标签")).Where(x => x.Length > 0)
        .Distinct(StringComparer.OrdinalIgnoreCase).Take(12).ToList();
    if (tags.Count() > 12 || cleaned.Count > 12) throw new ArgumentException("每台设备最多使用 12 个标签。");
    return cleaned;
}
static string NormalizeSubnet(string? subnet)
{
    if (string.IsNullOrWhiteSpace(subnet) || subnet.Length > 30) throw new ArgumentException("请选择有效的局域网 IPv4 网段。");
    var value = subnet.Trim();
    NetworkProbe.ExpandSubnet(value);
    var parts = value.Split('/');
    var bytes = IPAddress.Parse(parts[0]).GetAddressBytes();
    var prefix = int.Parse(parts[1]);
    for (var i = 0; i < 4; i++) bytes[i] &= (byte)(0xff << Math.Clamp(8 - (prefix - i * 8), 0, 8));
    return $"{new IPAddress(bytes)}/{prefix}";
}
static void ValidateSettings(AppSettings settings)
{
    if (settings.IntervalSeconds is < 15 or > 3600 || settings.TimeoutMs is < 200 or > 3000 || settings.PingCount is < 1 or > 5)
        throw new ArgumentException("采集周期应为 15–3600 秒，超时 200–3000 毫秒，每批 1–5 次 Ping。");
    if (settings.FailureThreshold is < 1 or > 10 || settings.RecoveryThreshold is < 1 or > 10) throw new ArgumentException("失败/恢复阈值应为 1–10 轮。");
    if (settings.RetentionDays is < 1 or > 30) throw new ArgumentException("历史保留天数应为 1–30 天。");
    if (settings.DiscoveryIntervalMinutes is < 5 or > 1440) throw new ArgumentException("自动发现间隔应为 5–1440 分钟。");
    if (!double.IsFinite(settings.LatencyThresholdMs) || settings.LatencyThresholdMs is < 1 or > 5000 || !double.IsFinite(settings.LossThresholdPercent) || settings.LossThresholdPercent is < 1 or > 100)
        throw new ArgumentException("延迟阈值应为 1–5000 ms，丢包阈值应为 1–100%。");
    Ports(settings.DefaultPorts);
    Text(settings.SiteName, 60, "站点名称");
    if (!string.IsNullOrWhiteSpace(settings.Subnet)) NormalizeSubnet(settings.Subnet);
}

public sealed record ScanRequest(string Subnet);
public sealed record AddDeviceRequest(string Ip, string? Alias, string? Type, string? Group, int[]? Ports, string[]? Tags, string? Owner, string? Location);
public sealed record EditDeviceRequest(string? Alias, string? Type, string? Group, string? Notes, bool? MonitoringEnabled, int[]? Ports, string[]? Tags, string? Owner, string? Location);
