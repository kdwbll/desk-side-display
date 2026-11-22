# 桌面副屏 · Desk Side Display

用 USB 把闲置的安卓手机变成横屏桌面摆件。Windows 上播放 Apple Music 或网易云音乐时，手机显示专辑封面和歌词。平时可以滑到时钟、相框、硬件监控，或自己排版的卡片页面。

[下载 Windows 版](https://github.com/kdwbll/desk-side-display/releases/latest) · [在线体验](https://kdwbll.github.io/desk-side-display/) · [使用说明](使用说明.md) · [参与贡献](CONTRIBUTING.md) · [MIT 许可证](LICENSE)

[![手机横放在显示器下方的支架上，屏幕显示专辑流光与逐字歌词](docs/screenshots/demo-device.jpg)](https://kdwbll.github.io/desk-side-display/)

点击上图打开在线演示。可以左右切页、操作卡片，也能在网页控制面板调整歌词外观和组件布局。演示静音，Windows 动作在网页内模拟。桌面场景使用实拍照片，屏幕内为当前版本的演示画面。

## 手机上能看到什么

![横屏歌词页左侧显示封面和曲名，右侧的当前句高亮扫过「我」字，屏幕边缘露出更多歌词](docs/screenshots/android-lyrics.webp)

**逐字歌词与专辑流光**。背景从封面提取主色，让色块沿平滑的随机路径移动。高亮用柔和的灰白渐变扫过正在唱的字。每行提前 0.1 秒开始切换，逐字高亮继续跟随校准后的时间戳。上下文延伸到屏幕边缘，透明度和模糊度可调。

| 全屏时钟预设 | 全屏相框预设 |
| --- | --- |
| ![时钟模式，横屏中央显示当前时间和日期](docs/screenshots/android-clock.webp) | ![相框模式，横屏显示群山与落日](docs/screenshots/android-photo.webp) |

时钟和相框可在控制面板按需添加。每个页面都可单独开启专辑流光。

![横屏卡片页包含两张快捷键卡片、音乐播放器、天气、GIF 和便签](docs/screenshots/android-widget-dashboard.png)

**自定义卡片**。手机左右滑动切页，每页最多 8 张卡片，总计最多 10 页。可添加天气、音乐、快捷键、便签、时钟、图片和 GIF 等卡片。启用相应权限后，点击便签可在 Windows 桌面新建并打开 TXT，点击快捷键卡片可发送预设的按键。切回页面时，天气和剪贴板会直接显示上次的内容，再按各自的间隔刷新。

| 硬件监控 | 剪贴板历史 |
| --- | --- |
| ![四张圆环卡片显示 CPU、GPU、内存和 GPU 温度的示例读数](docs/screenshots/hardware-dashboard.png) | ![流光背景上的独立剪贴板页面，卡片四边等距，列表显示示例文本](docs/screenshots/android-clipboard.png) |

硬件监控可显示 Windows 的实时读数。剪贴板历史支持文本、图片和文件名，启用组件动作后可点选条目粘贴到 Windows。上图中的歌词、封面、照片、天气、硬件读数和剪贴板内容均为演示数据。

## Windows 控制面板

![新版 Windows 控制面板的左侧栏目导航、页面顺序、横屏预览和组件像素宽高输入](docs/screenshots/windows-widget-layout.png)

- **界面与小组件**把页面顺序和横屏预览放在同一区域。可直接拖动、缩放和吸附对齐卡片，或输入像素宽高，保存后同步到手机。
- **组件数据源与权限**用于设置天气地点，启用便签等组件动作，以及配置剪贴板历史、窗口信息和自定义数据源。也可使用 AI 生成可导入的 JSON 组件。 [小组件规范](docs/widget-api.md)
- **歌词外观**支持实时预览歌词颜色、上下文不透明度、模糊度、流光速度和色块过渡，最多保存 10 组预设。
- **音乐播放**可在 Apple Music 和网易云音乐之间选择。只有一款在播放时可自动跟随，两款都在播放时提示选源。手机歌词、封面和播放按钮都跟随所选来源。
- **歌词进度**优先使用播放器上报的时间轴。网易云只提供曲目信息时，可按匹配到的总时长估算进度。需要网易云实时时间轴时，可使用 BetterNCM + InfLink-rs。 [播放源与歌词说明](使用说明.md#播放源与歌词)

![两款播放器同时播放时，控制面板在播放源下拉菜单旁提示手动选择](docs/screenshots/windows-dual-music.png)

![歌词外观实时预览及流光速度、色块过渡和外观预设](docs/screenshots/windows-control.png)

## 快速开始

1. 从 [GitHub Releases](https://github.com/kdwbll/desk-side-display/releases/latest) 下载 `DeskSideDisplay-win-x64.exe`，双击打开控制面板。EXE 已内置运行时，无需解压或安装 .NET。
2. 首次使用时，若面板提示缺少 Android USB 工具，阅读协议后点击「同意协议并下载」。手机开启 USB 调试，用数据线连上电脑，并在手机弹窗点「允许」。
3. USB 连接后副屏会尝试自动打开手机浏览器。把手机横放，轻点画面进入全屏。若浏览器没有自动打开，在手机访问 `http://127.0.0.1:8765/`。
4. 日常使用双击 EXE，再插上已授权的手机即可。电脑播放 Apple Music 或网易云音乐时可显示同步歌词，平时可切换时钟、相框或小组件页面。

首次配置、歌词匹配和排查步骤见[详细使用说明](使用说明.md)。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `DeskSideDisplay.csproj` | .NET 9 项目和构建配置 |
| `Program.cs` | Windows 服务入口、页面路由和本机接口 |
| `Services/Media/` | 读取 Windows 播放会话，在 Apple Music 和网易云音乐之间选源并控制播放 |
| `Services/Lyrics/` | 歌词匹配、时间轴解析、导入和校准 |
| `Services/Display/` | 硬件指标、剪贴板历史、快捷键与便签动作 |
| `Services/Settings/` | 界面布局、相框、卡片媒体、外观和预设的保存 |
| `Services/Usb/` | Android 设备识别与 USB 端口转发 |
| `wwwroot/control/` | Windows 控制面板 |
| `wwwroot/display/` | Android 横屏显示页 |
| `wwwroot/shared/` | 两个页面共用的组件、布局和歌词样式 |
| `docs/screenshots/` | 手机实拍与控制面板的演示截图 |
| `demo/` | GitHub Pages 在线体验和静态构建脚本 |

EXE 默认把本机数据和下载的 USB 工具保存在 `%LOCALAPPDATA%\DeskSideDisplay`。源码版使用仓库内的 `.data/` 和 `.tools/`，这两个目录由 Git 忽略。

## 许可与贡献

项目采用 [MIT 许可证](LICENSE)。欢迎 Fork、修改并提交 Pull Request。第三方依赖的版权声明、许可证以及参考项目列在[第三方声明](THIRD-PARTY-NOTICES.md)中。贡献流程见[参与贡献](CONTRIBUTING.md)。
