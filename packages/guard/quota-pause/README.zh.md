# @deepseek-ai/dsh-quota-pause

[English](README.md) | 中文

配额暂停 guard：当提供方因账户用量上限耗尽而拒绝模型请求时（Z.ai 的 `429 1308 "Usage limit reached for 5 hour. Your limit will reset at …"` 是现网实例），被拒轮的输入会被重新拼接回 agent 的 inbox，后续提案进入等待而不是反复失败；Web 会话的错误行在上限重置后提供「继续」按钮释放被暂停的工作，仍然受限的提供方会拒绝被释放的轮并重新暂停。

## 组合

主机层配置行（挂载于 `dsh-base` bundle）：

```yaml
- id: quota-pause
  name: '@deepseek-ai/dsh-quota-pause'
```

不支持任何配置；未知键在插件加载时失败。

## 机制

- **暂停**——携带 `LlmError` 代码 `QUOTA` 的 `agent/error` 把被拒轮的认领批次（通过 `agent/inbox/claimed` 跟踪）重新拼接到 `next-turn` 列表头部并暂停该 agent：后续每个 `agent/pre-step` 提案都被拒绝（`blocked` 轮，无模型调用），其批次原样重新拼接。
- **释放**——主机侧 `session.resumeAfterQuota` RPC 解析 agent（含冷会话）并调用 `QuotaPause.resume`：决策以被拒轮已记录的表面 id 武装，清除暂停并唤醒驱动器。武装的 `agent/pre-step` 决策通过循环的 `resume` 路径消费认领——暂停输入不再产生第二份表面副本，请求在被拒轮留下的日志上原样运行。暂停期间键入的输入仍正常浮出。
- **持久性**——暂停是一次 `agent/inbox/spliced` 追加，因此同一日志上的主机重启会以待处理状态回放暂停输入；`agent/created` 收养发现日志以配额拒绝结尾时，让 agent 以暂停态启动而不是再次失败。

## 模型体验

guard 不注入任何模型可见内容。被释放轮的请求历史恰好包含一次暂停输入——被拒轮记录的表面副本；模型不会看到重复提示或 guard 通知。重新暂停的工作保留原始消息 id。

## 已知限制与后续工作

- 暂停是基于持久 inbox 的按 agent 活动状态，收养时从日志重建；被干净关机规范化的日志（dispose 取消待处理输入）没有可释放的暂停工作——那本身就是用户可见的丢弃，语义正确。
- 不做提供方后台重探测：继续按钮就是释放动作，因为账户仍受限时自动定时器会消耗一次请求并循环重新暂停。
