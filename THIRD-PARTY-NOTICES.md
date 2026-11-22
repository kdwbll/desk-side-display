# 第三方组件与参考资料

## 编译和运行依赖

| 组件 | 用途和许可 |
| --- | --- |
| [YamlDotNet 18.1.0](https://www.nuget.org/packages/YamlDotNet/18.1.0) | 通过 NuGet 还原，用于解析 YAML 格式的逐字歌词。上游采用 MIT 许可证，仓库保留了该发布版本对应的[完整原文和版权声明](licenses/YamlDotNet.txt)。 |
| [.NET 9](https://dotnet.microsoft.com/download/dotnet/9.0) 和 Windows 媒体会话 API | 源码版由构建和运行环境提供。Windows EXE 内嵌 Microsoft .NET、ASP.NET Core 和 Windows Desktop 运行时。许可与第三方声明可在控制面板侧栏的「运行时许可」查看。 |
| [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) | 控制面板在用户同意 [Android SDK 许可协议](https://developer.android.com/studio/terms)后，从 Android 官网下载 USB 转发需要的文件。工具独立于 EXE 安装，并保留原包的 `NOTICE.txt`。 |
| [NVIDIA SMI](https://docs.nvidia.com/deploy/nvidia-smi/index.html) 与 [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) | 可选的本机硬件传感器来源，由显卡驱动或用户安装提供。NVIDIA SMI 适用驱动附带条款，LibreHardwareMonitor 采用 [MPL-2.0](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LICENSE)。项目通过命令行、WMI 读取指标。 |

## 开源项目参考

网易云音乐可通过独立安装的 [BetterNCM](https://github.com/std-microblock/chromatic) 与 [InfLink-rs](https://github.com/apoint123/inflink-rs) 向 Windows 提供媒体时间轴。副屏使用 Windows SMTC 接口读取。两项组件均由 GPL-3.0 上游项目独立分发。

- PhoneBox 用于参考 USB 连接与手机端面板的设计。上游许可证为 MIT。 [PhoneBox 许可证](https://github.com/ersinkoc/phonebox/blob/main/LICENSE)
- BetterLyrics 用于参考 Windows 媒体会话与歌词匹配的设计。上游许可证为 GPL-3.0。 [BetterLyrics 许可证](https://github.com/jayfunc/BetterLyrics/blob/dev/LICENSE)
- Kotonoha 用于参考在播放位置采样之间用本地时钟推进歌词的设计。 [Kotonoha 播放时钟协议](https://github.com/locez/kotonoha/blob/main/plugins/README.md#clock)
- Studio Waldbach 的 Liquid Glass CSS 用于参考分层模糊和饱和度。Nordify 的 CSS Liquid Glass 用于参考边缘高光与透明中心。两个项目均采用 MIT 许可。 [Liquid Glass CSS](https://github.com/waldbach/liquid-glass-css) · [CSS Liquid Glass](https://github.com/nordify/css-liquid-glass)
- Windows 控制面板的设计审查参考 Damir Sokolovsky（@heydamir）的 unslop 流程，原技能采用 CC BY 4.0。 [unslop](https://heydamir.design/unslop) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

本仓库对上述设计思路采用独立实现。项目的 MIT 许可适用于本仓库的原创代码与演示素材。第三方代码、工具、商标、歌曲、歌词及专辑封面的权利归各自权利人。运行时获取歌词涉及 [LRCLIB](https://lrclib.net/docs)、[AMLL](https://amll.dev/reference/http-api/native)和网易云音乐，使用歌词内容时应遵守相应来源的条款并尊重原权利。

## 天气数据

天气数据由 [Open-Meteo](https://open-meteo.com/) 提供，数据采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。内置天气源在用户填写经纬度后使用 Open-Meteo 的非商业免费接口。商用场景可通过自定义 JSON 接口接入获授权的数据源。 [Open-Meteo 服务条款](https://open-meteo.com/en/terms)

## 文档配图

[桌面布置图](docs/screenshots/desk-setup.jpg)和 [README 封面](docs/screenshots/demo-device.jpg)使用 kdwbll 提供的实拍照片，手机屏幕叠加项目的原创演示画面。原照片相关权利由拍摄者保留，配图经授权在项目文档中展示。
