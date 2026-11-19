# 自定义小组件

在 Windows 控制面板选择一个界面，展开「导入 AI 自定义组件」，点击「复制 AI 提示词」，把提示词里的用途换成自己的需求并发给 AI。拿到 JSON 后贴回面板，点击「校验并添加到本页」，最后点「保存界面」。也可以单独把 [JSON Schema](../wwwroot/shared/widget-v1.schema.json) 发给 AI。

## 示例

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
