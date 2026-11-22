# 参与贡献

1. 在 GitHub 上 Fork 本仓库，克隆 Fork 并创建分支。
2. 在 Windows 上按[使用说明](使用说明.md)准备环境，运行 `dotnet build`。页面修改可用启动脚本打开控制面板，并连接手机确认横屏显示。
3. 向本仓库的 `main` 分支提交 Pull Request，说明改动、验证方式及结果。界面改动可以附上演示截图。

提交演示用素材时，请使用自己有权分发的内容。提交第三方代码或素材时，请注明来源、对应版本和许可证，并随改动保留许可证要求的通知或署名。

在 Windows 上使用 .NET 9 SDK 运行 `powershell -ExecutionPolicy Bypass -File scripts/Publish-Windows.ps1 -Version 0.3.0` 可构建单文件 EXE。默认输出目录为 `artifacts/windows/`，构建会从 NuGet 和 .NET 上游仓库取得运行时及许可文件。
