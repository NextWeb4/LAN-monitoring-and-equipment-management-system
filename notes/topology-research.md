# 拓扑与企业网络监控项目研究

- 研究日期：2026-11-02
- 范围：LibreNMS、Netdisco、Zabbix 的官方仓库和官方文档；仅公开网页，不下载代码、不运行局域网扫描。
- 适用场景：20–500 台设备的中小企业、办公室、工作室。
- 证据状态：此前研究在内层 web 工具两次报 `503 no_available_account` 后，切换系统原生 web 工具读取官方网页。下列上游事实保留原来源；本次仅对本项目范围作本地源码审查，没有重新联网、构建、启动、扫描或测试。

## 结论

组合借鉴 LibreNMS 的自动发现和有来源的地图、Netdisco 的 MAC/IP/端口关联、Zabbix 的指标模板与告警依赖。当前源码包含台账、ICMP/TCP、站内事件、JSONL 近期历史与逻辑分组拓扑；SNMP/LLDP/CDP 物理拓扑为后续项。20–500 台为产品目标范围，未做容量实测。

当前采用 Windows 办公电脑上的 ASP.NET Core 8 普通后台程序、React/TypeScript 和 JSON 文件存储，不使用数据库。state.json 原子替换并保留 .bak，历史按日追加 JSONL；固定回环访问，无登录或 SCM 服务注册。三个上游项目仅供能力与模型参考，它们的数据库和运行栈不属于本项目依赖。

## 官方仓库

| 项目 | 官方仓库 | 本次适合借鉴的重点 |
|---|---|---|
| LibreNMS | https://github.com/librenms/librenms | 网络设备监控、自动发现、基于邻居数据生成地图 |
| Netdisco | https://github.com/netdisco/netdisco | MAC/IP 定位到交换机端口、网络资产和拓扑关系 |
| Zabbix | https://github.com/zabbix/zabbix | ICMP 指标、模板、触发器、告警依赖、发现后的自动化动作 |

## 逐项目已核实能力与边界

### LibreNMS

- 自动发现支持 ARP、FDP/CDP/LLDP 以及 SNMP 网络扫描。需配置 SNMP 凭据和允许的网段；ARP 发现依赖设备 ARP 表采集。扫描也有 ICMP-only/fallback 选项。[L1]
- 动态网络地图来源包括 xDP 邻居和 ARP-IP-MAC 匹配；xDP 对应 FDP/CDP/LLDP。官方建议大网络使用设备邻居或设备组地图，避免全局图过大。[L2]
- 特性页明确列出 VLAN、ARP、FDB 表采集、告警、分布式轮询和服务监控；服务监控通过 Nagios 插件集成。[L3]
- 规则支持设备离线和物理接口状态异常，具有严重级别、静默、恢复通知、设备/组匹配等选项。[L4]
- 必须区分“快速 Ping 检查”与质量测量：`ping.php` 只测 up/down，收到首次响应就停止，不测丢包或平均时延；不能把该任务宣称为完整 Ping 质量监控。[L5]
- 官方安装流程涉及 Linux、PHP 依赖、MariaDB、PHP-FPM、Web 服务、调度器等；部署复杂度评为中高是本研究基于组件数量的判断，并非官方评级。[L6]
- LICENSE 正文声明 GPLv3，且包含第三方软件包例外；具体复用应核对所选版本及对应文件。[L7]

### Netdisco

- README 明确：使用 SNMP、CLI 或设备 API 收集 IP/MAC 到 PostgreSQL，能够按 IP/MAC 定位终端所在的交换机端口，并管理网络设备资产。[N1]
- 配置文档区分邻居信息入库与递归发现排队；支持依据 CDP/LLDP 信息筛选设备。`macsuck`、`arpnip` 等任务各自可配置调度和范围。[N2]
- 文档特别处理“不通过 SNMP 提供 MAC 表”的设备：终端可能只能记录在上游端口；无拓扑时让终端积聚到 uplink 的选项被标为调试用途。由此推论，端口定位必须保留来源与不确定性，不能将上联观察当成终端直连事实。[N2]
- README 描述 Perl/Python、PostgreSQL、轻量 Web 服务和后端采集 daemon，也提供容器镜像入口。部署复杂度评为中等是本研究判断。[N1]
- 本次资料不足以确认其原生 ICMP 丢包/时延历史和通用告警是否满足本项目要求；不把这些能力写成“没有”，也不选它作为首版唯一监控引擎。
- LICENSE 正文为 BSD 3-Clause。[N3]

### Zabbix

- 网络发现使用 IP 范围、服务可用性、Zabbix agent 或 SNMP agent 信息；发现事件可用于通知、添加主机、分组、关联模板等动作。官方特别明确该功能不提供网络拓扑发现。[Z1]
- 官方 ICMP Ping 模板提供可达性 `icmpping`、丢包百分比 `icmppingloss` 和响应秒数 `icmppingsec`。模板包含连续三次超时触发、五分钟统计窗口和告警依赖；这些是适合借鉴的抗抖动与告警抑制机制。[Z2]
- 有网络地图编辑和展示能力，但该地图功能不能等同于 LLDP/CDP 自动发现能力。[Z1][Z3]
- 容器默认部署由 server、Web 和 MySQL/PostgreSQL 数据库组成；可加 proxy 等组件。部署复杂度评为中高是本研究对组件/配置面的判断。[Z4]
- 本次查看 master 的 COPYING 为 AGPLv3；不要用过去版本的许可证印象代替待选版本的实际文件。[Z5]

## 当前 MVP 与未来增强

1. 当前包含台账、单个私有 IPv4 网段发现、ICMP/TCP、近期曲线与事件；发现/监测共用互斥门，目标并发上限24。没有排除地址列表或分布式采集器。
2. 当前保存 UUID、IP/MAC/hostname、别名、分组、备注和地址变化，MAC 变化及同时多 IP 会触发身份提醒。厂商识别、独立网卡模型和人工合并/拆分尚未实现。
3. 综合状态为 online/offline/unknown，保留 ICMP 计数、TCP 结果与文字证据；完整持续失败才产生离线事件。SNMP 观测尚未实现。
4. 当前 TCP 检测区分 open/closed/timeout/error；UDP、交换机物理接口与接口计数器均为后续项。
5. 当前逻辑拓扑围绕站点/分组中心绘制监测范围连线，支持筛选、分页、状态与 RTT；没有人工连线、TopologyEdge 或物理邻接。未来关系模型才需要 source_type、protocol、last_seen 和置信状态。
6. 当前 active/resolved 事件持久化、按键去重并可确认；连续失败/恢复计数在内存中。通知为站内与获准的浏览器通知；邮件/Webhook/outbox/重试/维护窗口/冷却尚未实现。
7. 最多500台是代码管理限制，未经负载验证。多 VLAN、多办公室、IPv6、SNMP/LLDP/CDP 须另行开发并按现场数据源验证。

源码证据：[Models.cs](../src/Lantern/Models.cs)、[MonitorService.cs](../src/Lantern/MonitorService.cs)、[FileStateStore.cs](../src/Lantern/FileStateStore.cs)、[App.tsx](../frontend/src/App.tsx)、[pages.tsx](../frontend/src/pages.tsx)。

## 能力与设备条件（基于官方能力说明的工程推论）

| 需求 | 当前或未来的数据来源 | 实现边界 |
|---|---|---|
| 设备 IP 与在线状态 | 当前：ICMP、配置的 TCP、Windows 同链路 SendARP | 单次失败不等于关机，本地错误与过期单独处理 |
| MAC/IP 对应 | 当前：SendARP；未来：网关 ARP/ND | 跨路由 MAC 需另一侧数据源，当前不保证可得 |
| 终端连接交换机端口 | 未来：MAC 转发表、接口/VLAN、网关 ARP/ND | 尚未实现，需可查询的网管设备与凭据 |
| 交换机间拓扑 | 未来：SNMP/设备 API 读取 LLDP/CDP | 尚未实现，当前连线只表示统一监测范围 |
| 接口速率、错误、流量 | 未来：SNMP 接口计数器/设备 API | 尚未实现，需 MIB/API 和访问配置 |
| 主机名称 | 当前：反向 DNS、用户别名；未来：mDNS/设备元数据 | 自动名称可能未知，当前可手动命名 |

上游依据：[L1][L2][L3][N1][N2][Z1]。未来接入前需检查可查询性和邻居协议支持，绘图无法补足缺失观测。当前仅展示逻辑分组/监测范围，没有物理或人工设备间连接。

## 后续增强顺序（尚未实现）

1. 对文件存储版本开展 Windows 运行、实际网段与容量验证，补充全量历史查询和归档设计。
2. 网管增强：SNMP 凭据与能力识别 → 接口/VLAN/FDB/ARP → MAC/IP/端口关系。
3. 物理/人工拓扑：LLDP/CDP 邻居 → 端口级观测 → 双向关系归并和人工编辑 → 来源与过期状态。
4. 扩展：邮件/Webhook、维护窗口、上游故障抑制、远程认证、多 VLAN/多办公室采集器。

## 官方来源索引（2026-11-02 读取）

- [L1] LibreNMS Auto-discovery： https://docs.librenms.org/Extensions/Auto-Discovery/
- [L2] LibreNMS Network Map： https://docs.librenms.org/Extensions/Network-Map/
- [L3] LibreNMS Features： https://docs.librenms.org/Support/Features/
- [L4] LibreNMS Alert Rules： https://docs.librenms.org/Alerting/Rules/
- [L5] LibreNMS Fast Ping Checking： https://docs.librenms.org/Extensions/Fast-Ping-Check/
- [L6] LibreNMS Installation： https://docs.librenms.org/Installation/Install-LibreNMS/
- [L7] LibreNMS LICENSE： https://github.com/librenms/librenms/blob/master/LICENSE.txt
- [N1] Netdisco README： https://github.com/netdisco/netdisco
- [N2] Netdisco Configuration： https://github.com/netdisco/netdisco/wiki/Configuration
- [N3] Netdisco LICENSE： https://github.com/netdisco/netdisco/blob/master/LICENSE.md
- [Z1] Zabbix Network discovery： https://www.zabbix.com/documentation/current/en/manual/discovery/network_discovery
- [Z2] Zabbix ICMP Ping integration： https://www.zabbix.com/integrations/ping
- [Z3] Zabbix Network maps： https://www.zabbix.com/documentation/current/en/manual/config/visualization/maps
- [Z4] Zabbix Containers： https://www.zabbix.com/documentation/current/en/manual/installation/containers
- [Z5] Zabbix COPYING： https://github.com/zabbix/zabbix/blob/master/COPYING

## 研究限制

本次为官方文档能力核查，没有部署上游项目，没有实测 20/100/500 设备负载，没有评估所有硬件型号支持情况，也没有验证跨 VLAN 凭据与访问配置。未引用星数、版本优劣或维护活跃程度作为选型依据。
