# Windows 本地构建与后台运行

这些脚本启动普通后台程序，通过浏览器访问。当前没有注册 Windows SCM 服务。

## 环境

- Windows 10/11 或具有 PowerShell、CIM、`Get-NetTCPConnection` 的 Windows Server。
- 首次构建需要 Node.js LTS/npm，以及 .NET 8 SDK；更高 SDK 也必须同时具备 .NET 8 和 ASP.NET Core 8 运行时。
- 已有 `artifacts/app` 发布产物时，仅需 .NET 8 和 ASP.NET Core 8 运行时。
- 优先使用 `%USERPROFILE%\.dotnet\dotnet.exe`，其次检查 `DOTNET_ROOT`、PATH 和 Program Files。当前开发机 SDK 位于 `C:\Users\Administrator\.dotnet\dotnet.exe`，无需依赖 PATH 中只有运行时的 dotnet。
- 初次安装 npm 依赖和还原 .NET 项目可能需要网络；脚本不会自动安装 SDK。

## 使用

双击根目录 `start.cmd`。如尚无发布产物，脚本先构建，再启动后台程序并打开 <http://localhost:5188>。后端绑定 `127.0.0.1:5188`，默认只允许本机浏览器访问。

从仓库根目录执行以下命令可分别构建、启动和停止：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1 -NoBrowser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop.ps1
```

更新代码后先停止，再运行 `build.ps1`，最后重新启动。存在发布文件时，`start.ps1` 直接运行该版本，不会自动重建。

`build.ps1` 在 `frontend` 执行 `npm ci`（无锁文件时为 `npm install`）及 `npm run build`，要求 Vite 输出至 `src/Lantern/wwwroot`；随后将 ASP.NET Core 项目以依赖运行时的方式发布至 `artifacts/app`。

## 数据、日志和进程

默认数据目录为仓库根目录下的 `data`，与启动命令所在目录无关。设置 `LAN_DATA_DIR` 可指定其他目录；相对目录按照仓库根目录解释。启动、停止必须使用相同的环境变量值。

每次新启动生成独立的 `launch-时间-stdout.log` 和 `launch-时间-stderr.log`。`lantern.pid` 记录启动进程，`launch.lock` 防止同一数据目录下的启停操作交错。锁文件保留在磁盘上不代表仍被占用，实际锁随进程退出释放。

重复启动会查找命令行中具有准确发布 DLL 路径的已有 dotnet 进程并复用，不会额外启动一份。端口被其他程序占用时会报告 PID，不会关闭该程序。

停止脚本只处理 PID 文件指向的进程，并再次核对进程名和完整 DLL 路径；没有 PID 文件或归属不符时不会终止进程。`Stop-Process` 属于进程终止，并非应用级优雅关闭；内存中尚未落盘的最后一次状态可能丢失。已有数据文件及日志保留。

启动就绪通过进程归属及 TCP 监听端口确认，不发送 HTTP 请求。45 秒内未监听会报告日志位置，并保留仍在运行的进程供排查。

可按需将 `start.cmd -NoBrowser` 快捷方式放入当前用户的登录启动文件夹；这属于用户登录后启动后台程序。仓库脚本不会自行注册服务或计划任务。
