# 首版实现接口（无数据库）

Windows 本机 `http://127.0.0.1:5188`；后端 ASP.NET Core net8.0。默认回环监听；所有 `/api` JSON 使用 camelCase。前端生产构建输出到 `src/Lantern/wwwroot`。无外部字体/CDN。

GET `/api/state` → `{settings,devices,incidents,scan,collector:{status,lastCycleAt,error},adapters,history:[{deviceId,probe}],storage:{mode:"json-files",retentionDays},now}`。历史仅近期缓存，单设备请求历史。
GET `/api/devices/{id}/history` → `[{deviceId,probe}]`，最多最近 240 批。
GET `/api/bootstrap` → `{csrfToken}`；写请求发送 `X-Lantern-Token`，fetch 使用同源。
POST `/api/scan` `{subnet}` → 202 扫描任务；POST `/api/scan/cancel` 停止。
POST `/api/probe` → 手动触发一轮现有设备监控。
POST `/api/devices` `{ip,alias,type,group,ports}` → 新设备。
PATCH `/api/devices/{id}` `{alias,type,group,notes,monitoringEnabled,ports}` → 更新设备。
DELETE `/api/devices/{id}` → 删除指定设备、清空该设备内存历史并将相关活动事件标记为已解决（界面需确认）；保留磁盘历史至到期清理。
PUT `/api/settings` → 完整 settings 对象。默认 subnet 为空，用户在设置中保存网段后才自动发现。autoDiscoveryEnabled 默认 true、discoveryIntervalMinutes 默认 10（允许 5–1440）；自动发现依赖全局 monitoringEnabled。发现窗口的手动扫描只启动一次，不修改保存的网段。
POST `/api/incidents/{id}/ack` → 确认。
GET `/api/export` → 配置/设备/事件 JSON 下载（不含运行令牌）。
错误统一 `{error:"中文说明"}` + 对应非 2xx。

DTO 以 `src/Lantern/Models.cs` 为准。设备 status: online/offline/unknown；TCP status: open/closed/timeout/error；scan status: idle/running/completed/cancelled/failed。关闭监测展示暂停，过期状态由后端转 unknown。没有演示设备或虚构指标。

网络层 `NetworkProbe`：
- `IReadOnlyList<AdapterInfo> GetAdapters()`
- `static string[] ExpandSubnet(string subnet)`，限制 RFC1918 IPv4 /22–/32，排除网络/广播（/31 /32按主机处理），最多1024目标。
- `static bool IsAllowedIp(string ip)` 仅 RFC1918 IPv4 或 loopback（用于本机诊断）。
- `Task<ProbeResult> ProbeAsync(string ip, int[] ports, int packets, int timeoutMs, bool resolveName, CancellationToken cancellationToken)`。

配置/设备/告警原子写入 `data/state.json`，旧版本 `.bak`；采样按天追加 `data/history/yyyy-MM-dd.jsonl`，有限保留。内存仅保留每设备最近240条，前端返回全局最多120条。探测/扫描不会默认启动对未知网段的操作。

新发现设备仅将此次连接成功的 TCP 端口纳入持续监测；已有设备的告警只针对其当前配置端口。端口可在设备详情中调整，发现结果不会自动替换用户配置。
历史文件达到 32 MB 后分片；历史目录总量保护为 512 MB，达到上限后暂停新增磁盘采样并在界面显示存储提示，设备最新状态继续保留。默认保留 7 天，可调 1–30 天，容量上限优先于保留天数。恢复备份仅覆盖 state；JSONL 是追加日志，没有独立备份。
