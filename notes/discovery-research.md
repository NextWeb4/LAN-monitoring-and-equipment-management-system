# 局域网设备发现与监测项目调研

核验日期：2026-11-02。范围：NetAlertX、WatchYourLAN、Uptime Kuma。依据为各仓库当前官方 README 与 LICENSE 页面；未部署项目、未扫描局域网、未做源码运行验证。

## 1. WatchYourLAN：轻量发现与设备在线历史

**官方已确认事实**

- 提供网络主机清单、在线/离线历史、新主机通知；支持 InfluxDB2/Prometheus 输出。
- Docker 快速部署明确要求 host 网络。Linux 安装依赖 `arp-scan`、`tzdata`；支持配置扫描接口及 ARP 参数。
- SQLite 为默认数据库，也支持 PostgreSQL；通过 Shoutrrr 接入通知服务。
- 无内置认证，官方建议配合认证代理；提供离线前端资源方案。

来源：[官方 README](https://github.com/aceberg/WatchYourLAN)。许可证为 **MIT**，已直接核验 [LICENSE](https://github.com/aceberg/WatchYourLAN/blob/main/LICENSE)。

**对本项目的设计建议（推断）**

适合借鉴设备台账、扫描调度、状态历史、通知适配器的简洁设计。用户已选择 Windows 办公电脑部署，不能把上述 Linux/host 网络安装说明当作 Windows 原生支持证据。应单独实现或验证 Windows 采集器。当前 README 证据也不足以把它视为完整的 Ping 丢包分析和物理拓扑系统。

## 2. NetAlertX：多来源发现与集中资产管理

**官方已确认事实**

- 支持 arp-scan、DHCP/Pi-hole 数据、UniFi 控制器与 SNMP 路由器导入；提供扫描插件和工作流。
- 跟踪设备连接状态、未授权资产、IPAM 变化；支持通知、API/Webhook 和 Prometheus。
- Sync Nodes 用于 VLAN、分支等场景的分布式采集与集中管理。
- Docker 示例使用 host 网络以及 `NET_RAW`、`NET_ADMIN`、`NET_BIND_SERVICE` 能力。
- FAQ 明确提示 ARP 可能无法发现其他子网设备；远端网络需要适当网络可达性和扫描配置。

来源：[官方 README](https://github.com/netalertx/NetAlertX)。许可证为 **GPL-3.0**，已直接核验 [LICENSE.txt](https://github.com/netalertx/NetAlertX/blob/main/LICENSE.txt)。

**对本项目的设计建议（推断）**

优先学习“多采集来源统一设备身份”和“采集器与中心分离”。跨 VLAN 不能仅靠把扫描网段扩大；应考虑各网段采集器、网络设备数据或控制器接口。Windows 版本应先验证其真实二层可见范围；不要把 Linux 容器能力假设为 Docker Desktop 可直接等价提供。当前证据未验证完整 Ping 丢包功能或自动物理拓扑。

## 3. Uptime Kuma：监测、告警与状态界面

**官方已确认事实**

- 支持 HTTP(S)、TCP、Ping、DNS、WebSocket 等监测，提供 Ping 图表、状态页和 2FA。
- README 列出 20 秒监测间隔、SMTP 及 90 多种通知服务。
- 非 Docker 安装明确支持 Windows 10 x64、Windows Server 2012 R2 x64 或更高；列出的依赖为 Node.js 20.4 或更高、Git、PM2。
- 持久化目录需要本地文件系统；README 明确不支持 NFS。

来源：[官方 README](https://github.com/louislam/uptime-kuma)。许可证为 **MIT**，已直接核验 [LICENSE](https://github.com/louislam/uptime-kuma/blob/master/LICENSE)。

**对本项目的设计建议（推断）**

这是三者中已找到明确 Windows 原生部署说明的监测参考，适合学习监测任务、通知管理、历史图表和 Web 交互。当前 README 不构成其具备自动资产发现、MAC 台账或物理拓扑的证据，不能直接替代整个目标系统。

## 4. Windows 落地建议与待验证项

设计建议：Windows 常驻采集服务负责探测和数据写入，浏览器负责管理界面；把设备身份、IP 地址、观测记录和探测结果分开存储。对首次发现、连续失败和恢复设置状态转换规则，避免一次 ICMP 超时直接判定设备离线。

以下属于下一阶段验证工作，尚未完成官方文档核验或本机实验：

- .NET `System.Net.NetworkInformation.Ping` 的异步探测接口与权限行为。
- Windows IP Helper `GetIpNetTable2`、`ResolveIpNetEntry2` 的邻居表读取/解析及接口范围。
- 无响应 ICMP 设备、Windows 防火墙、VPN/多网卡、Wi-Fi 隔离、跨网段 MAC 不可得等实际行为。
- 拓扑证据模型：手工连接、推断连接与来自 LLDP/CDP/SNMP 的已观测连接需分别标注来源。

## 5. 核验过程

原生联网工具多次返回 `503 no_available_account`；改用 xbrowser 浏览器访问官方公开页面，读取 README 和许可证页面正文。未下载源码，未执行文档中的安装命令。项目能力与部署条件来自上述官方页面；架构建议已明确标为推断。GitHub 页面数据随仓库更新可能变化，实际集成时还应固定依赖版本和对应许可文件。
