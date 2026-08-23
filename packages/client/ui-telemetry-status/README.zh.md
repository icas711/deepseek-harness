# @deepseek-ai/dsh-client-ui-telemetry-status

[English](README.md) | 中文

General 设置区的遥测状态表面，双面 Client 插件的浏览器半边：已挂载后端的共享披露（`host.telemetryStatus`）、刷新控件，以及——当部署支持实时模式变更时——写入 `session-telemetry` 设置分节的模式选择器。节点半边是空的 `apply`。

## 注册表面

- `dsh.client` 清单（浏览器名册；见 web-app bundle patch）
- `tsconfig.client.json` 聚合引用
- `packages/bundle/web-app` 配置行 + 包依赖

## 行为

- **披露**——一次 `host.telemetryStatus` 调用渲染该行：实时 `sharing` 策略、设置分节当前解析到的模式（`configuredMode`），以及部署能否不重启就更改它（`changeable`）。未组合遥测后端的主机只渲染说明文字（`unavailable`）；披露在 `session-telemetry` 命名空间的 `settings/document-updated` 和连接重置时刷新。
- **模式变更**——当 `changeable` 为真时，选择器写入 `settings.update({ ns: 'session-telemetry', patch: { mode } })`；后端实时更换捕获流水线（见 `@deepseek-ai/dsh-session-telemetry-otel`）。写入被拒绝时的消息（例如无可用导出器的上传模式）显示在行内；每次写入后重新读取披露，该行始终显示后端自己的状态。

## 模型体验

仅浏览器侧设置控件；不进入 Session 日志、模型上下文或遥测。

## 已知限制与后续工作

- 该行只提供后端 schema 定义的封闭模式集合；未来使用不同词汇的后端需要自己的表面或更宽的披露。
