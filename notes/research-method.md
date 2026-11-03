# 调研记录

日期：2026-11-02；工作目录：`D:\NTWK`。

## 执行范围

用户提出局域网监控与设备管理系统需求，并要求先在 GitHub 找类似项目学习借鉴。本文记录此前调研阶段；用户随后要求无需数据库并开始构建，当前实现见 `reports/implementation.md`。

## 环境与资料入口

- 开始时工作目录为空，无 `cases/*/state.json` 可恢复，已创建 `cases/lan-monitor/state.json`。
- 已搜索当前工具清单：无 `kb_router`、`kb_read_file`、`send_http2_request`、`http_probe`、`search_in_sources`。
- 第二条知识库查找路径：MCP 资源与模板列表均为空；因此无法执行原协议中的知识库路由。
- `web` 的搜索、直接打开 GitHub 两种调用均收到服务层 `503 no_available_account`；这不代表 GitHub 仓库不可用。
- 回退浏览器读取公开 GitHub/官方文档。`xbrowser init` 已返回 ready，由设备发现研究路径集中操作默认会话，避免并发导航冲突。
- 设备发现路径最终实核 NetAlertX、WatchYourLAN、Uptime Kuma 的 README 和 LICENSE；拓扑路径通过其可用网页入口实核 LibreNMS、Netdisco、Zabbix 与 Windows Service/SQLite 官方文档。各路径的来源与摘要已独立落盘。
- 用户随后确认部署目标为 Windows 办公电脑、浏览器访问；实现阶段采用 ASP.NET Core 普通后台进程，未注册 Windows SCM 服务。
- 未使用 curl/wget；未下载 JS 或项目源码；未执行局域网扫描。

## 结论约束

- 项目功能和许可证必须对应官方页面链接；无法访问的页面明确注明未核实。
- 架构、容量、阈值和里程碑是本项目建议，不写成参考项目的现成功能或实测结果。
- 不凭搜索摘要宣称最新版本、星数或维护活跃度。
- 只比较与所需功能有直接关联的少量项目，保留后续源码研究的入口。
