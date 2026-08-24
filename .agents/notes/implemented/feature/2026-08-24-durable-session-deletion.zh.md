# Agent Note: 会话持久删除

Status: implemented

[English](2026-08-24-durable-session-deletion.md) | 中文

## 问题

Web GUI 此前只能归档会话，无法删除。归档只隐藏行而不触碰日志，因此存储空间只增不减，想让会话彻底消失的用户只能带外删除持久化根目录下的文件——Workspace 注册表的记账和归档集合对此一无所知。两个第一方后端都在已知限制中写明「不删除会话文件」，反馈 sidecar 的 Agent Note 也记录了不存在可以负责任地执行级联的删除权威。

删除不是销毁。`session/disposed` 与 `host/session-removed` 描述的是脱离 live ownership；被删除会话的日志必须离开持久化，注册表必须忘记它，所有客户端都要丢弃该行。活体删除还必须决定：另一个宿主界面附加了 agent 的会话谁能删，子代理围栏身份会怎样。刚销毁会话的写后清空与工件移除存在竞态，而且对已经不存在的 id，操作必须保持幂等。

## 决策

### 持久化层拥有移除原语

`SessionPersistence.delete(id)` 属于服务契约（`ctx.sessionPersistence`）。协调器在会话处于活体时拒绝——调用方先销毁它——然后在按 id 串行化的链**之外**等待进行中 retirement 的最终清空，因为该清空自身的尾部可能仍排在同一条链上，从链内等待会死锁。最终清空失败不会阻塞删除：这些事件本来就要被丢弃，与 retirement 的只观察姿态一致。串行化核心丢弃保留的 preparation，并委托后端的 `deleteStored(id)`；对缺失 id 幂等地完成，该 id 随后可复用。

- JSONL 在可读的项目目录中解析唯一匹配的会话目录（跨两个项目分布的 id 属于歧义的持久状态，会拒绝），递归移除它，并跳过预期路径上的非目录——与列出逻辑所见一致。兄弟会话和项目目录保留。
- SQLite 删除 `sessions` 行；`ON DELETE CASCADE` 在同一条语句中移除其 `events` 行。

### 网关拥有编排

Host RPC `session.delete` 按顺序组合销毁、工件移除与注册表忘记：

1. **活体**会话通过销毁本代理持有的 agent 句柄（`agentHandles`）完成删除，因此运行中的轮次以销毁原因取消。agent 被其他宿主界面附加的活体会话返回 `session-ownership`（携带 `sessionId` 的新错误码）；子代理围栏身份无论活体还是冷态均返回 `agent-busy`。
2. **冷态**会话只作检查，不恢复、不发布 agent；未知 id 返回 `session-not-found`。
3. 销毁与清空之后，`persistence.delete` 移除工件，随后 `WorkspaceRegistry.forgetSession(sessionId)` 丢弃头部索引、归档集合成员身份以及每个 workspace 的 `sessionIds` 记账——每次写入都是持久化的。忘记在日志移除之后执行，自身绝不触碰日志；对未记录的 id 幂等地完成。
4. 持久提交后，冷删除在 host 流推送一帧 `host/session-removed`。活体路径的该帧已随 mux 流上的 `session/disposed` 发出，因此只有冷路径会铸造这一帧。注册表帧（`host/archived-sessions-changed`、`host/workspace-changed`）跟随忘记写入。

没有持久化的组合返回 `internal`，与其他所有持久操作一致。

### 客户端本地执行同样的拆除

`ISessions.delete(sessionId)` 在 Host 提交后完成，并执行与 `host/session-removed` 帧完全相同的拆除，标记为发起端的本地回显。因为发起端知道删除是持久的，经本地回显移除的子代理来源行按持久断开处理：后代索引丢弃它，同 id 重新添加也无法重新挂接——帧路径保持原先仅断开的姿态，因为单独一帧不能证明日志被删除而不是 agent 被销毁。遭到拒绝时以携带线上错误的 `SessionDeleteError` 拒绝；行保持不变。

### UI 先确认再销毁

Workspace 浏览器的 Session 行菜单新增危险样式的**删除会话**菜单项，打开指名会话并声明删除不可逆的确认对话框。确认后两个底部操作禁用，直到 Host 返回结果；遭到拒绝时对话框保持打开并显示错误。浏览器调用其 `deleteSession` slot contribution，后者委托给 `ISessions.delete`。文案以 zh/en/ru 三语发布。

## 曾考虑的替代方案

**复用 `workspace.archiveSession` 并加「清除」标志。** 归档是日志存活之上的注册表记账；把工件移除折叠进去会让一个 RPC 具有两种持久含义，并让归档集合无法区分某行能否回归。

**只通过 Workspace 注册表删除。** 注册表拥有分组而非日志；它无法针对活体 agent 排序「先清空再移除」，而且对仍持久化的会话执行注册表忘记，会在下次引导扫描时让该行复活。

**在串行化链内等待最终清空。** 会与清空自身排队的尾部死锁。在链外等待既保留了顺序（核心仍然串行化），又让清空先行结束。

**让最终清空失败导致删除失败。** 清空的事件正是这场等待它的删除要丢弃的东西；flush 错误恰逢销毁时让 RPC 失败，会留下一个无法删除的会话。

**级联反馈 sidecar。** sidecar 以头部身份 `{createdAt, cwd}` 为键，本就阻止遗留行变成复用 id 的反馈，而 `session.delete` 在网关层组合，storage-domain sidecar 不在其作用范围内。行保留至带外清理；见[消息反馈 sidecar 决策](../architecture/2026-08-10-message-feedback-sidecar.md)。

**活体路径也推送 `host/session-removed`。** 代理持有的活体 agent，客户端已经能观察 `session/disposed`；再加一帧会对同一行双重拆除，且两条流之间没有顺序保证。

## 后果

删除从此成为横跨持久化 seam、Workspace 注册表、RPC 面与 Web UI 的一等持久操作，而此前每一层都记录着它的缺失。收益：一条真正回收存储并保持注册表记账真实的用户可见路径，一个未来任何宿主界面都能调用的幂等原语，以及一个命名多界面活体 agent 规则的 `session-ownership` 错误码。代价：新的线上错误码与方法，以及协调器的删除要等待（但容忍失败）已销毁会话最终清空的规则——删除完成意味着日志已消失，绝不是半消失。反馈 sidecar 刻意不级联；其行比会话存活得更久，直到被带外移除，这一点记录在它自己的 Agent Note 和 README 中。

## 测试

持久化契约测试套件以持久、幂等的删除以及活体拒绝与销毁后删除约束每个后端；协调器测试固定清空等待与清空失败容忍；JSONL 测试固定目录移除、杂散文件跳过与跨项目拒绝；SQLite 测试固定行级联且兄弟行完好。网关测试覆盖活体销毁、`session-ownership`、两条路径上的 `agent-busy`、`session-not-found`、冷路径帧、后端失败与无持久化组合。Workspace 测试覆盖归档席位忘记、幂等幽灵、日志缺失时的重启。运行时测试覆盖本地回显拆除、子代理持久断开、当前选中清空与 `SessionDeleteError`；UI 测试覆盖确认对话框文案、重复提交阻断与失败重试。一个 keyless web e2e 场景走完组装后的产品路径——行菜单、确认对话框、行移除、宿主侧日志消失、重载后不复现——复用 seeded-history 固定件且不做新录制；`realizeSeedFixture` 对替换的 cwd 做 JSON 转义，使 seeded 场景在 Windows 上同样可以回放。
