# Agent Note: 配额暂停与实时遥测模式

Status: implemented

[English](2026-08-16-quota-pause-and-live-telemetry-mode.md) | 中文

## 问题

Z.ai GLM 会话在账户用量上限处中断（`429 code 1308 "Usage limit reached for 5 hour. Your limit will reset at …"`）：该轮以终态错误结束，已被认领的输入被消耗，上限重置后唯一的恢复方式是重新输入提示词。遥测模式同样被冻结：`session-telemetry-otel` 只在插件构造时读取一次 `mode`，更改共享策略需要重启进程，而 General 设置行也没有可读取披露信息的主机 RPC。

## 决策

**暂停而不是丢弃**（新增 `packages/guard/quota-pause`）。配额拒绝是账户状态，不是请求失败：在轮内重试毫无意义，丢弃输入则是数据丢失。guard 将被拒轮的认领批次（通过 `agent/inbox/claimed` 跟踪）重新拼接进持久 inbox，并拒绝后续提案（`blocked` 轮，无模型调用）。暂停因此依托 inbox 自身的持久性——在同一日志上重启的主机会以待处理状态回放该输入，`agent/created` 收养时发现日志以配额拒绝结尾，会让 agent 以暂停态启动而不是再次失败。

**沿已记录日志释放**（`packages/core/agent`、`agent-loop`）。把暂停的文本作为新用户消息重发会复制表面——被拒轮已记录其 `user/message` 副本。`PreStepDecision` 新增 `{ kind: 'resume' }`：在已记录日志上的进入，消费认领而不追加任何新表面内容。武装化的决策以被拒轮的 `user/message` id 为键，因此暂停期间键入的输入仍会与静默的暂停批次一起正常浮出。释放无需探测提供方即保持诚实：仍然耗尽的账户会拒绝被释放的轮，随即重新暂停。`Agent.wake()`（同一批次加入）无需新输入即可释放暂停的工作；Web 会话的 QUOTA 轮错误行通过 `session.resumeAfterQuota` RPC 提供继续按钮，该 RPC 用与提示相同的 agent 机制解析冷会话。

**模式作为分层设置**（`packages/session/session-telemetry-otel`）。`session-telemetry` 分节的 `mode` 变化时，后端整体重建其捕获流水线（协调器监听器加 SDK 提供方，各在一个可释放的子 fiber 上）；模块级 handoff 游标保证重建不会重复导出上一化身已交接的记录。组合条目是基础层；设置提供方脱离时回退到它。`host.telemetryStatus` 一次调用披露 `{sharing, configuredMode, changeable}`，写入路径就是普通的 settings 更新——没有平行的变更面。`session-telemetry` 命名空间加入 Web 暴露的设置列表，General 行（新增 `packages/client/ui-telemetry-status`）在 `changeable` 时渲染披露信息和模式选择器。

**路由命名**（`packages/llm/llm-zai`，现挂载于 base bundle）。pi-ai 的内置目录为它自己的 adapter 家族拥有裸 `zai` 可配置提供方路由；本原生 adapter 注册 `zai-official`，镜像 `deepseek-official`，使两个家族无需触发重复目录异常即可共存。

## 考虑过的替代方案

**释放时把暂停输入作为新用户消息重发。** 已否决，因为这会复制被拒轮已记录的表面副本：恢复的请求会两次携带同一提示词，派生历史也会把同一文本显示为两个用户轮。

**定时重试被拒请求直到上限重置。** 已否决，因为账户仍受限时自动定时器会消耗一次请求并循环重新暂停；继续按钮正是释放动作，因为用户知道上限何时重置。

**持久的「已暂停」标记事件。** 已否决为冗余：被拒的 `turn/end` 加上暂停的 `agent/inbox/spliced` 追加已编码该状态，收养从二者推导暂停。标记事件会引入需要保持一致的第三个事件。

**武装释放前探测提供方。** 已否决，因为正确性不需要它——被释放的轮再次失败即重新暂停——而探测会消耗暂停所保护的配额本身。

## 后果

配额被拒的会话保留其输入并提供显式续行；恢复的请求在被拒轮留下的日志上原样运行，暂停的提示词恰好浮出一次。模式更改无需重启即生效，settings seam（及其修订冲突、校验和最后良好值行为）是唯一写入路径。代价：暂停是按 agent 的活动状态（WeakMap），收养时从日志重建，而不是持久的模式；被干净关机规范化的日志没有可释放的暂停工作，这是正确的，因为那次关机的 inbox 取消本身就是用户可见的丢弃。`resume` 决策现在是 pre-step 契约的一部分，因此每个读取 `decision.messages` 的 `agent/pre-step` 监听器都必须把非 `enter` 决策视为直通（所有已发布监听器已更新，loop 自身的测试固定了该语义）。GLM 模型可作为 `zai-official` 与 pi-ai 目录的休眠 `zai` 条目并列选择。

## 验证

- `packages/core/agent-loop/tests/interception.spec.ts` —— resume 决策在已记录日志上运行模型，输入恰好浮出一次。
- `packages/guard/quota-pause/tests/quota-pause.spec.ts` —— 暂停/保持、不重复浮出的释放、暂停后新输入混合、仍受限提供方下的重新暂停、基于持久化被拒日志的收养暂停。
- `packages/session/session-telemetry-otel/tests/settings-mode.spec.ts` —— 面向真实 OTLP 模拟收集器的实时模式切换、重建间的游标存活、无可用导出器时的写入拒绝、脱离回退。
- `packages/host/apiproxy/tests/client-handler.spec.ts` —— 两个新 RPC 穿过协议 schema，包括封闭词汇围栏。
- `packages/client/ui-telemetry-status/tests/*` —— 披露、模式写入、拒绝渲染；`packages/client/ui-conversation/tests/chat-view.client.spec.tsx` —— 配额继续按钮（提供、在后续轮关闭后退役、其他失败码下不存在）。
