# 局域网监控 MVP 设计审查

更新日期：2026-11-02。用户已确认 Windows 办公电脑部署、本机浏览器访问和不使用数据库。本文按当前源码更新事实与边界；仅做文档及源码静态审查，未构建、启动、扫描、测试或测量容量。

## 当前架构

- ASP.NET Core 8 API 与 BackgroundService 采集任务运行在同一普通后台进程；启动脚本隐藏启动，不是 SCM Windows Service。
- React + TypeScript 提供总览、设备、逻辑拓扑、提醒与设置。后端固定 `127.0.0.1:5188`，无账户登录。
- 无数据库。`state.json` 保存设置、设备和事件，先写 `.tmp` 并刷新，再原子替换并保留 `.bak`；历史按日追加 JSONL。
- 原生采集使用 .NET Ping、TCP Connect、Windows 同链路 SendARP 和反向 DNS，无 Npcap 或外部扫描器依赖。

依据：[Program.cs](../src/Lantern/Program.cs)、[FileStateStore.cs](../src/Lantern/FileStateStore.cs)、[NetworkProbe.cs](../src/Lantern/NetworkProbe.cs)、[Windows 启动说明](windows-run.md)。

## 正确性审查与待验证场景

| 项目 | 当前源码行为 | 边界与后续验收 |
|---|---|---|
| 设备身份 | UUID 持久化、同网段 MAC 辅助匹配、最多 50 次地址变化；MAC 变化暂停旧设备，同时多 IP 的同 MAC 产生提醒 | 无 MAC、随机 MAC、多网卡和代理 ARP 需人工核对；没有合并/拆分界面。需现场验证 DHCP 迁移与 IP 复用 |
| 在线与离线 | ICMP 应答、TCP 成功/拒绝、同链路 ARP 成功提供可达依据；默认 3 轮完整失败离线，2 轮成功恢复告警 | TCP 拒绝表示目标有响应，但服务仍异常；不可达不等同断电，跨路由 MAC 不保证可得 |
| 缺测和本地错误 | Ping 执行失败不加入发送数；采样过期显示 unknown；长间隔后清空连续计数，不补发休眠期任务 | 关机/休眠/程序停止时无采样；无独立观察者。需验证唤醒和曲线缺测行为 |
| 丢包与 RTT | 保存 Sent/Received/RttSumMs；零发送丢包为 null、无应答 RTT 为 null；近 5 分钟完整样本至少 4 轮/12 包，按包数加权 | 无 RTT 最小/最大值和持久化长期汇总；详情最多返回设备近期 240 条缓存 |
| 告警 | active/resolved 事件及确认/时间持久化，规则键去重；新设备、身份、离线、端口、丢包、延迟事件；已恢复最多 1000 条 | 触发前计数在内存，重启重新累计；采集/存储错误显示状态，不创建独立采集器事件；无维护窗口 |
| 通知 | 站内中心与新活动事件提示；用户允许后运行中的页面发浏览器通知 | 无邮件/Webhook/outbox/投递重试或恢复桌面通知；页面关闭不发桌面通知，首次加载不补发旧事件 |
| 拓扑 | 按站点/分组显示逻辑监测范围，状态/IP/RTT 节点可跳转详情；明确连线非物理布线 | 无人工连线、拓扑边模型、SNMP/LLDP/CDP/FDB/交换机接口指标 |
| 状态文件 | state.lock 独占目录；状态串行写临时文件、Flush(true)、替换并保留 .bak；读取失败尝试备份 | 状态与历史无跨文件事务，强制终止可能丢最后一批；.bak 不是多版本或异地备份 |
| 历史保留 | 默认 7 天，可配 1–30；超过 32 MiB 后分片；512 MiB 总量保护，达到后暂停磁盘追加并提示；启动仅读最近 4 文件且每个最多尾部 4 MiB | 单批可能略超阈值；今日文件不因容量自动删除；无完整历史分页 API；500 台是管理上限非实测容量 |
| 资源与范围 | 私有 IPv4 /22–/32，最多 1024 目标/500 设备/每设备16 TCP端口；目标并发24、TCP每目标4、ARP全局16；发现与监测互斥、扫描可取消 | 无排除清单、IPv6、多采集器；多网卡/VPN/Wi-Fi 隔离和静默设备需现场验证 |
| 本机访问 | 回环与 Host 限制；写 API 会话令牌/同源检查；启停脚本核对精确 DLL 路径 | 无登录、多用户或远程共享。远程访问须另行实施认证与传输保护，不能仅改监听地址 |

代码证据：[Models.cs](../src/Lantern/Models.cs)、[MonitorService.cs](../src/Lantern/MonitorService.cs)、[FileStateStore.cs](../src/Lantern/FileStateStore.cs)、[NetworkProbe.cs](../src/Lantern/NetworkProbe.cs)、[App.tsx](../frontend/src/App.tsx)、[pages.tsx](../frontend/src/pages.tsx)。

## 容量与后续范围

若 500 台设备严格每分钟一批，每日为 720,000 条 JSONL；TCP 结果嵌在批次中增加字节数，实际调度还包含探测耗时。该算术不是实测，512 MiB 保护可能先于保留天数生效。应按实际设备数、端口数、周期观察增长，再决定文件索引、汇总与归档方案。

SCM 服务安装、远程认证、邮件/Webhook、维护窗口、完整历史查询、人工连接、SNMP/LLDP/CDP 物理拓扑均为后续开发项。构建运行与现场验收由主任务交付记录提供，本审查不宣称这些功能已实现或性能已验证。
