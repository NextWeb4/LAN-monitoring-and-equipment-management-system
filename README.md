# LANtern · 局域网监控与设备管理

面向中小企业、办公室和工作室。Windows 后台程序，浏览器访问；使用 JSON/JSONL 文件存储，**无需数据库**。

## 启动

双击根目录 `start.cmd`，打开 [本机工作台](http://127.0.0.1:5188)。当前仅允许安装电脑访问。

首次从源码构建需要 Node.js/npm 和 .NET 8 SDK。已有 `artifacts/app` 发布文件时，仅需 .NET 8 与 ASP.NET Core 8 运行时。脚本优先使用用户目录下的 `.dotnet`。

1. 打开“发现设备”，选择网卡对应的私有 IPv4 网段，开始一次发现；也可手动添加已知 IP。
2. 在“设置”保存默认发现网段，启用自动发现；默认每 10 分钟发现一次、每轮监测完成后间隔 60 秒再次监测。
3. 在设备详情中设置别名、类型、分组、标签、负责人、位置、备注与 TCP 监测端口；设备台账支持搜索、分页和批量更新。
4. 设备管理页可下载 CSV 模板、预览导入结果、导入设备清单，或导出当前设备资产；JSON 全量导出仍在“设置”中提供。
5. 查看总览、趋势、异常提醒、网络逻辑拓扑和运行报告。需要桌面提醒时，在设置中开启浏览器通知并保持页面打开。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1 -NoBrowser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop.ps1
```

更新代码后先停止、重新构建，再启动。详细环境和进程说明见 [Windows 运行说明](notes/windows-run.md)。

## 已实现

- 局域网发现：网卡识别、私有 IPv4 /22–/32 范围扫描、定时发现、进度与取消。
- 设备台账：IP、同网段可获取的 MAC、反向 DNS 名称、别名、分类、分组、标签、负责人、位置、备注、地址变化记录、暂停/删除；支持搜索、分页与批量更新。
- 监测：ICMP 延迟/丢包、指定 TCP 端口连接、在线/离线/待确认状态、近期曲线。
- 告警：新设备、持续离线、延迟/丢包异常、端口异常、设备身份变化；事件确认、去重和恢复记录。
- 导入导出：CSV 模板、浏览器端格式预览、服务端逐行验证、重复 IP 拒绝、CSV 资产导出和 JSON 全量导出。
- 运行报告：按 1 小时至 30 天窗口汇总已有采样、在线率、平均延迟、丢包、端口结果、活动告警、风险设备与处理建议；支持 CSV/JSON 报告导出。
- 展示：中文总览、设备详情、逻辑拓扑、告警页、运行报告和设置。

## 文件存储

默认放在项目 `data` 目录，可用 `LAN_DATA_DIR` 指定本地目录。

| 文件 | 用途 |
|---|---|
| `data/state.json` | 配置、设备、事件；临时文件写入后原子替换 |
| `data/state.json.bak` | 上一次状态快照，主文件不可读时尝试恢复 |
| `data/history/*.jsonl` | 按 UTC 日期追加采样，默认保留 7 天，可调 1–30 天 |
| `data/launch-*.log` | 启动与运行日志 |

历史文件约 32 MB 分片，历史目录约 512 MB 容量保护优先于保留天数；到达上限时显示提示。界面每设备最多显示最近 240 批采样，启动时仅载入有限文件尾部。需要完整备份时先停止程序，再复制整个 `data` 目录；导出按钮不包含原始历史日志。

## 当前边界

- 普通 Windows 后台进程，尚未注册 Windows 系统服务或开机自启；电脑休眠/关闭会停止采集。
- 首版设备上限 500 台，尚未做容量实测；一次扫描最多 1,024 个目标，只覆盖私有 IPv4。
- MAC 依赖同网段 ARP，设备名依赖 DNS；跨 VLAN、禁用响应或隔离设备的信息可能为空。
- 拓扑展示监测范围和设备状态；交换机物理端口、SNMP/LLDP/CDP 邻接采集尚未实现。
- 提醒为站内事件与页面打开期间的浏览器通知，邮件/Webhook 尚未接入。
- CSV 导入仅接受局域网 IPv4、受支持的设备类型和最多 16 个 TCP 端口；导入不会探测设备，导入后由后续监测采集实际状态。
- 运行报告只使用当前本机保存的设备状态、最近内存历史和活动事件，不代表 SLA、可用性审计或物理网络拓扑。

## 项目资料

- [实现说明与验证记录](reports/implementation.md)
- [GitHub 调研与实施方案](reports/lan-monitor-plan.md)
- [接口和文件格式](notes/implementation-contract.md)
- [参考项目清单](exports/reference-projects.json)
- [项目状态与下一步](cases/lan-monitor/state.json)

后端位于 `src/Lantern`，前端位于 `frontend`，发布产物位于 `artifacts/app`。
