# 自定义小组件

在 Windows 控制面板选择一个界面，展开「导入 AI 自定义组件」，点击「复制 AI 提示词」，把提示词里的用途换成自己的需求并发给 AI。拿到 JSON 后贴回面板，点击「校验并添加到本页」，最后点「保存界面」。也可以单独把 [v2 JSON Schema](../wwwroot/shared/widget-v2.schema.json) 及以下示例发给 AI。导入后的组件可点「编辑组件 JSON」修改。

## v2 示例

```json
{
  "version": 2,
  "widget": "example.world-clock",
  "kind": "clock",
  "name": "世界时钟",
  "size": "medium",
  "color": "#7de8c8",
  "format": {"locale": "zh-CN", "timeZone": "Asia/Shanghai", "hourCycle": "h23", "dateStyle": "full"},
  "layout": {"columns": 2, "gap": 10, "padding": 12, "align": "center"},
  "theme": {"dark": {"background": "#222B36"}, "light": {"background": "#F3FCFC", "foreground": "#202B33"}},
  "motion": {"type": "fade", "durationMs": 450, "easing": "ease-out"},
  "blocks": [
    {"kind": "clock", "label": "上海"},
    {"kind": "text", "text": "{{time}}\n{{date}}", "fontScale": 1.2},
    {"kind": "progress", "source": "time.second", "span": 2, "max": 60, "format": {"unit": " 秒"}}
  ],
  "x-example-author": {"name": "社区作者"}
}
```

每个组件最多 12 个块。布局可指定 1–4 列、行列跨度、间距、内边距、字体比例和起始/居中/末尾对齐。类型包括 `text`、`value`、`image`、`files`、`icon`、`ring`、`progress`、`clock`、`button`。各块独立绑数据，允许把多个圆环和表盘放在一起。动态圆环可用 `time.second`、`time.minute`、`time.hour` 或 `time.dayprogress`。

主题可指定 `light`、`dark` 的背景、前景和强调色，也可启用高对比度。动效支持淡入、脉冲、上移和弹跳，以及可选缓动、时长和循环，系统开启减少动态效果时会停用。日期格式使用 `short`、`medium`、`long`、`full`，时区使用 IANA 名称，时制可选 `h12` 或 `h23`。

## 数据源与权限

| 数据前缀 | 类型及来源 | 所需授权 |
| --- | --- | --- |
| `time`、`date`、`time.*` | 本机格式化文字或时钟进度数字 | — |
| `music.*`、`media.*` | 歌曲标题、歌手、进度、播放状态、封面或相框图片 | — |
| `cpu.*`、`gpu.*`、`ram.*` | 硬件读数和显卡名称 | — |
| `clipboard.text`、`clipboard.image`、`clipboard.files`、`clipboard.history` | Windows 当前剪贴板内容和最多 25 条历史。单个文件条目预览前六个文件名及图标 | 声明 `clipboard`，并在面板开启 |
| `notification.*` | 本机通知桥推送的最新标题、正文、应用名、计数 | 声明 `notifications`，并在面板开启 |
| `window.*` | Windows 前台窗口标题和进程名 | 声明 `window`，并在面板开启 |
| `volume.*` | Windows 默认输出设备的音量、静音状态 | — |
| `network.*`、`power.*` | 网络名称、联通状态、收发速度（B/s）、电量、供电与充电状态 | — |
| `weather.*` | 当前温度、体感温度、WMO 天气代码、风速、湿度、昼夜状态和地点名称 | 声明 `weather`，并在面板填写经纬度 |
| `api.<别名>.<路径>` | 用户注册接口的 JSON 标量。可用 `api.desk.rooms.0.temperature` 访问数组元素 | 声明 `interfaces`，并在面板注册别名 |

完整字段和类型可在 [v2 Schema](../wwwroot/shared/widget-v2.schema.json) 的 `x-data-types` 查询。`valueType` 可约束接口字段，类型不符时按缺值处理。缺值默认显示 `—`，可用 `fallback` 改写。`maxLength` 截断文字并补省略号，`digits` 和 `unit` 覆盖数字精度和单位。`refreshMs` 可设为 500–60000 毫秒。同页的数据请求按已绑定组件中最短的间隔轮询，远程接口按其注册的刷新下限缓存。旧接口字段缺失或异常时会显示缺值。

在「组件数据源与权限」里可注册 JSON 接口，例如：

```json
[{"id":"desk","url":"http://127.0.0.1:9000/status","refreshMs":10000}]
```

组件只写 `api.desk.<字段>`。地址由 Windows 面板管理，支持 HTTPS 和本机 HTTP。每次读取最多 128 KB，使用 GET，响应可为文本、数值、布尔值或适用于图片块的 PNG/JPEG/WebP/GIF Base64 数据地址。文件块显示文件名和可用缩略图；剪贴板中的原始文件路径留在电脑。

## 声明式动作

用以下字段开启合法的动作。手机端还须有 USB 连接，并由用户在数据源面板启用动作。

```json
{
  "permissions": ["actions"],
  "actions": {
    "tap": {"type": "music.toggle"},
    "longPress": {"type": "copy", "value": "要复制到 Windows 的文字"},
    "swipeLeft": {"type": "music.next"}
  }
}
```

`button` 布局块也可加 `action`。动作包括上一首/暂停切换/下一首、刷新、复制文字，以及 `{"type":"open-app","value":"notepad"}`。打开应用使用控制面板注册的本机 EXE 别名。组件声明的滑动动作只在从该卡片开始时生效，其他区域沿用左右滑切页。长按约 650 毫秒后松开触发。

## 剪贴板示例

[剪贴板组件 JSON](../wwwroot/shared/examples/clipboard-widget.json)以可滚动列表显示最近 25 条内容，最新的在上面。文本和图片直接读取 Windows 的 Win+V 历史。文件只显示图标和名称，在服务运行且启用了历史组件时记录到本机内存。关闭剪贴板权限或移除最后一个历史组件后会清除这些文件记录。没有内容时，组件在卡片中央显示半透明「暂无内容」。

开启剪贴板和组件动作后，点击一项会恢复该条内容并粘贴到 Windows 当前焦点。单次复制的多个文件是一条记录，按整组粘贴。Windows 的文本和图片历史需要在系统中开启 Win+V。 [Microsoft 剪贴板历史说明](https://support.microsoft.com/en-gb/windows/apps/using-the-clipboard)

`clipboard.history.paste` 用于绑定 `clipboard.history` 的 history 块。只展示当前剪贴板的组件仍可用 `clipboard.paste`，将其放在绑定 `clipboard.text`、`clipboard.image` 或 `clipboard.files` 的内容块。`fileDisplay: "icon"` 可给单独的 files 块关闭缩略图，`hideWhenEmpty` 可隐藏空内容块，`layout.firstPresent` 可按顺序选择第一个可见块，`empty` 定义全空时的提示。粘贴组件需声明 `clipboard` 和 `actions`。

## 通知桥

开启「接收本机通知桥的推送」，点「复制通知桥连接信息」即可将本机地址、临时请求头和 JSON 结构交给自己的提醒程序或通知桥。把有权共享的通知通过 `POST /api/widget-notifications` 发给桌面副屏，标题键为 `title`，可选 `body`、`app`。便携版使用这个本机接口接收通知，Windows 通知中心的读取由有相应权限的外部桥接程序负责。连接密钥在服务启动时生成，勿把密钥放进组件 JSON 或发给 AI。

## 兼容与扩展

v1 导入和已保存的 v1 组件可继续使用。要迁移，可在「编辑组件 JSON」中把 `version` 改为 `2`，加可选的 `"migratedFrom": 1`，保留原模板，再按需添加布局块。 `widget` 和 `kind` 是可选的社区组件标识与分类。带 `x-` 前缀的顶层元数据会随组件保存，并可由社区扩展读取。自定义数据提供者可以先用注册接口接入。要增加原生来源或布局类型，可分别改动 `WidgetSources`、`WidgetProtocol`、`widget-v2.js` 和 Schema。

保存界面时，自定义组件会同步加入 Windows 面板的可复用列表。同一个 `widget` 标识共用一份定义，每次添加会创建独立的组件实例。随附的[天气组件](../wwwroot/shared/examples/weather-widget.json)用 `kind: "weather"` 的布局块，把 `shape` 设为 `card`、`round`、`capsule` 或 `square`。可选的 `transparency` 为 0 到 100 的整数，默认 30。0 为实色，100 为透明。动画来自当前天气与系统的减少动态效果设置。

## v1 示例

```json
{
  "version": 1,
  "name": "电脑状态",
  "size": "medium",
  "color": "#7de8c8",
  "template": "内存 {{ram.used}}",
  "detail": "CPU {{cpu.usage}} · GPU {{gpu.temperature}}",
  "gauge": "ram.usage"
}
```

`template` 是主文字，`detail` 是补充文字。可选的 `gauge` 用单个指标画圆环。尺寸为 `small`、`medium` 或 `large`，分别占 1、2 或 4 列。导入后仍可在 Windows 调整尺寸和颜色。

| 类别 | 可用的数据标记 |
| --- | --- |
| 日期与音乐 | `{{time}}`、`{{date}}`、`{{music.title}}`、`{{music.artist}}`、`{{music.progress}}`、`{{music.duration}}` |
| CPU | `{{cpu.usage}}`、`{{cpu.temperature}}` |
| GPU | `{{gpu.name}}`、`{{gpu.usage}}`、`{{gpu.temperature}}`、`{{gpu.power}}`、`{{gpu.fan}}`、`{{gpu.clock}}` |
| 内存 | `{{ram.used}}`、`{{ram.total}}`、`{{ram.usage}}` |

模板文本以纯文字显示。缺失的读数显示为 `—`，数值自动附带单位。需要发送快捷键时，在控制面板添加内置「键盘快捷键」组件并启用 USB 快捷键。

## 本机校验接口

`POST http://127.0.0.1:8766/api/pages/validate-widget` 接收 JSON，成功时返回规范化后的组件对象，校验失败时返回 HTTP 400。由 Windows 控制面板同源调用，使用 `X-DeskSide-Control: 1` 和 `Content-Type: application/json`。
