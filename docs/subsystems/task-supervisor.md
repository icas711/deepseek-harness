# Супервизор долговечных задач

Сервис `ctx.taskSupervisor` ([`@deepseek-ai/dsh-task-supervisor`](../../packages/host/task-supervisor/README.md)) ведёт реестр задач в домашней папке и переживает рестарты процесса: чистая остановка паркует незавершённые задачи одной атомарной записью, следующий старт сам возобновляет припаркованные, а задачи, на которых предшественник умер, помечаются `interrupted` до явного `resume`. Проектное решение — [Agent Note о мягком рестарте](../../.agents/notes/implemented/feature/2026-10-17-task-supervisor-soft-restart.md); эта страница фиксирует публичный контракт сервиса, а [README пакета](../../packages/host/task-supervisor/README.md) владеет композицией и Model Experience.

## Реестр и статусы

Документ `task-registry.json` хранит записи `{ taskId, sessionId, title, status, updatedAt, stationId? }`. `taskId` — [брендированный идентификатор](core.md#branded-ids), `status` — закрытый набор `running`/`paused`/`interrupted`/`waiting-station`/`completed`/`failed`, а необязательный `stationId` привязывает задачу к станции [моста станций](stations.md). Каждая мутация коммитит весь документ через writer-lock из `dsh-atomic-write`: читатели видят только целое старое или целое новое содержимое, второй процесс с общей домашней папкой сливается по `taskId`, а битый документ роняет загрузку сервиса громко.

`track({ sessionId, title, stationId? })` идемпотентен по сессии: повторный вызов перезаписывает заголовок, явный `stationId` перепривязывает запись, а у сессии с терминальной задачей открывается новая задача с новым `taskId`. `markCompleted` и `markFailed` фиксируют исход, `list()` возвращает копии записей, `resume(taskId)` возобновляет `paused`/`interrupted`/`waiting-station` задачу и при неудаче возвращает запись к прежнему статусу.

## Офлайн-ожидание станции

Задача с `stationId` исполняется в мире своей станции: когда мост станций сообщает событием `station/status` об уходе станции, супервизор одной атомарной записью переводит её `running`-задачи в `waiting-station`; ход агента при этом не гасится. Возврат станции продолжает задачу автоматически по механике `paused → resume`: холодная сессия открывается с перепримененным миром станции (fs-station/subprocess-station в скоупе агента), и в сессию доставляется обычное сообщение-продолжение со станционной формулировкой — кроме случая, когда ход всё ещё в полёте: тогда задача продолжает текущий шаг сама, без лишнего ввода. Статус `waiting-station` переживает рестарт хоста; возобновление требует мост станций в композиции — без него привязанная задача не возобновляется (громкий `resume-unavailable`).

## Жизненный цикл вокруг рестарта

При выгрузке fiber'а супервизор сперва гасит незавершённые возобновления, затем одной записью переводит все `running`-задачи в `paused` и только потом разбирает поднятых им агентов. При старте `running`-записи означают жёсткий сбой предшественника: они одной записью помечаются `interrupted` и возобновляются только явно, `paused`-записи возобновляются сами, как только в композиции появляется фабрика агентов. Пустой реестр — пассивный режим: сессии не открываются, в логе тихо.

## Продолжение после рестарта

Каждое возобновление доставляет в сессию одно обычное пользовательское сообщение с источником `plugin: @deepseek-ai/dsh-task-supervisor` — продолжение входит в модель через обычный логируемый путь, без новых типов событий. Дословный текст продолжения фиксирует [README пакета](../../packages/host/task-supervisor/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtasksupervisor--tasksupervisor"></a>

### `ctx.taskSupervisor` — `TaskSupervisor`

The task supervisor service (`ctx.taskSupervisor`).

```ts cordis-catalog
/**
 * Track work on a session. Idempotent by session id: a repeated call
 * retitles the existing active record or commits nothing when nothing
 * changed; an explicit `stationId` rebinds the record, an omitted one
 * keeps the previous binding; a session whose record is terminal
 * (completed/failed) gets a fresh task identity.
 * @param request - the session whose agent performs the work, the
 * human-readable task label, and the optional execution station the work
 * is bound to (ownership is validated by the caller — the RPC boundary).
 * @returns the up-to-date durable record.
 * @throws {@link TaskSupervisorError} with `stopping` during teardown.
 */
async track(request: { sessionId: SessionId; title: string; stationId?: StationId }): Promise<TaskView>

/**
 * Mark a task completed.
 * @param taskId - the task to settle.
 * @returns the committed record.
 * @throws {@link TaskSupervisorError} with `unknown-task`,
 * `invalid-transition` (terminal or wrong status), or `stopping`.
 */
async markCompleted(taskId: TaskId): Promise<TaskView>

/**
 * Mark a task failed and account for the reason in the log. The durable
 * record carries the fixed field set; the reason travels through the log,
 * not the registry file.
 * @param taskId - the task to settle.
 * @param reason - non-empty human-readable failure account.
 * @returns the committed record.
 * @throws {@link TaskSupervisorError} with `invalid-reason`, `unknown-task`,
 * `invalid-transition`, or `stopping`.
 */
async markFailed(taskId: TaskId, reason: string): Promise<TaskView>

/**
 * Snapshot the whole registry for callers outside the service, such as a
 * notification watcher diffing task statuses between ticks.
 * @returns fresh copies of every record, in registry order. Safe before
 * initialization settles: the read follows {@link TaskSupervisor.ready}.
 */
async list(): Promise<TaskView[]>

/**
 * Resume one parked, interrupted, or station-waiting task: reopen its
 * session (reusing a live agent, otherwise resuming from persistence with
 * the task's station world) and deliver the continuation message through
 * the ordinary logged input path. The automatic station-driven path uses
 * the same mechanics, skipping the input while a turn is still in flight.
 * @param taskId - the task to resume.
 * @returns the running record.
 * @throws {@link TaskSupervisorError} with `unknown-task`,
 * `invalid-transition` (already running or terminal), `stopping`,
 * `resume-unavailable`, or `session-not-found`; the record reverts to its
 * previous status when the resume itself fails.
 */
async resume(taskId: TaskId): Promise<TaskView>
```

Types: [SessionId](core.md)

Source: [`packages/host/task-supervisor/src/index.ts:53`](../../packages/host/task-supervisor/src/index.ts)
<!-- END GENERATED cordis-surface -->
