# Windows 平台研究证据与当前无数据库实现

- 更新日期：2026-11-02。
- 本次范围：只读核对当前源码和脚本；未重新联网、安装、构建、启动、扫描或测试。
- 官方摘要保留自同日早期调研，描述平台能力，不等于项目已经采用。

## 当前选择：普通后台进程与 JSON 文件

项目为 net8.0 ASP.NET Core Web 应用，BackgroundService 运行采集任务。未引用 Microsoft.Extensions.Hosting.WindowsServices、未调用 AddWindowsService，脚本不注册 SCM 服务。`scripts/start.ps1` 用隐藏的 Start-Process 启动发布 DLL，日志/PID 写入数据目录。构建为依赖本机运行时的发布，需要 .NET 8 与 ASP.NET Core 8；首次构建还需 SDK 和 Node.js/npm。

Program.cs 固定监听 `http://127.0.0.1:5188`，允许 localhost/127.0.0.1 Host，当前无登录。写 API 使用会话令牌与同源检查。内容根和 wwwroot 基于 AppContext.BaseDirectory，不依赖启动目录。脚本默认 LAN_DATA_DIR 为仓库下绝对 data 路径；直接运行 DLL 未设变量时用应用目录下 data。

按用户要求，当前无需数据库：

- state.json 保存设置、设备、事件；先写同目录 .tmp、刷新，再 File.Replace 替换并保留 .bak；首次保存采用移动。
- 启动先读主文件、再读备份；已有主文件/备份均不可读时停止，避免空台账覆盖。
- state.lock 独占数据目录，状态写入与历史写入各自串行化。
- 历史按 UTC 日追加 JSONL，超过 32 MiB 后分片，默认保留 7 天，可配 1–30 天；有 512 MiB 总量保护。状态和历史无共同事务，不承诺断电零损失。
- 通知为站内事件与用户允许的浏览器通知，后者要求页面运行。邮件/Webhook、持久化投递队列和重试未实现。

证据：[Lantern.csproj](../src/Lantern/Lantern.csproj)、[Program.cs](../src/Lantern/Program.cs)、[FileStateStore.cs](../src/Lantern/FileStateStore.cs)、[MonitorService.cs](../src/Lantern/MonitorService.cs)、[App.tsx](../frontend/src/App.tsx)、[构建脚本](../scripts/build.ps1)、[启动脚本](../scripts/start.ps1)。这是源码范围，运行和负载结论另行记录。

## 保留的官方研究：ASP.NET Core Windows 服务

官方入口：[Windows Service 托管](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/windows-service)。早期实际读取 [ASP.NET Core 10.0 文档视图](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/windows-service?view=aspnetcore-10.0)，不是本项目 net8.0 运行验证。

当时读取摘要：

- ASP.NET Core 可直接托管为 Windows Service，无须 IIS，服务可随系统重启自动启动。
- 文档使用 Microsoft.Extensions.Hosting.WindowsServices 和 AddWindowsService，并示例注册 AddHostedService 后台任务。
- 自包含发布可携带运行时；服务仍需注册、账号权限和启动类型配置。服务当前目录可能是 `C:\WINDOWS\system32`，文件路径应使用内容根或绝对路径。

该文档作为未来 SCM 服务安装的研究入口。当前仅有普通后台进程与依赖运行时的发布，不能称为已经安装 Windows 服务或配置服务恢复。

## 保留的官方研究：SQLite WAL（当前未采用）

官方来源：[SQLite WAL](https://sqlite.org/wal.html)。早期读取 Overview、Concurrency 后记录：

- WAL 支持读写并发，同一数据库任一时刻只有一个写者。
- 使用 WAL 的进程须位于同一主机，wal-index 依赖共享内存，不适用于网络文件系统。
- 长读事务可能阻碍 checkpoint，需要考虑 WAL 增长与事务长度。

以上仅是 SQLite 的官方事实和研究出处。用户随后明确无需数据库，当前 LANtern 采用 JSON/JSONL，没有 SQLite 包、WAL、数据库迁移或数据库容量承诺；不能将 WAL 特性套用于项目文件存储。
