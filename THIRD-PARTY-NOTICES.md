# 第三方组件与参考资料

## 编译和运行依赖

| 组件 | 用途和许可 |
| --- | --- |
| [YamlDotNet 18.1.0](https://www.nuget.org/packages/YamlDotNet/18.1.0) | 通过 NuGet 还原，用于解析 YAML 格式的逐字歌词。上游采用 MIT 许可证，仓库保留了该发布版本对应的[完整原文和版权声明](licenses/YamlDotNet.txt)。 |
| [.NET 9 SDK](https://dotnet.microsoft.com/download/dotnet/9.0) 和 Windows 媒体会话 API | 由 Windows 构建和运行环境提供。 |
| [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) | 由使用者从 Android 官方下载。项目通过本机的 ADB 执行 USB 端口转发。下载和使用适用 [Android SDK 许可协议](https://developer.android.com/studio/terms)及软件包附带的通知。 |

## 开源项目参考

- PhoneBox 用于参考 USB 连接与手机端面板的设计。上游许可证为 MIT。 [PhoneBox 许可证](https://github.com/ersinkoc/phonebox/blob/main/LICENSE)
- BetterLyrics 用于参考 Windows 媒体会话与歌词匹配的设计。上游许可证为 GPL-3.0。 [BetterLyrics 许可证](https://github.com/jayfunc/BetterLyrics/blob/dev/LICENSE)

本仓库对上述设计思路采用独立实现。项目的 MIT 许可适用于本仓库的原创代码与演示素材。第三方代码、工具、商标、歌曲、歌词及专辑封面的权利归各自权利人。运行时获取歌词涉及 [LRCLIB](https://lrclib.net/docs)、[AMLL](https://amll.dev/reference/http-api/native)和网易云音乐，使用歌词内容时应遵守相应来源的条款并尊重原权利。

## 文档配图

[桌面布置图](docs/screenshots/desk-setup.jpg)根据 kdwbll 提供的实拍照片制作，手机屏幕叠加项目的原创演示画面。原照片相关权利由拍摄者保留，配图经授权在项目文档中展示。
