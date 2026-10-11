# @deepseek-ai/dsh-worktree

Capability-пакет git-worktree (`ctx.worktrees`): жизненный цикл worktree (create/list/remove) и веточные глаголы флота (diff против merge-base, merge ветки с откатом конфликта). Service Definition и локальный git-провайдер живут в одном пакете, пока не появится второй провайдер (удалённые execution worlds) со своей скоростью эволюции.

Каждый глагол — один ограниченный git-подпроцесс через [subprocess-seam](../../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md): провал отдаётся наружу с stderr git (fail loud), каталог репозитория остаётся в согласованном состоянии.

## Сервис: `Worktrees` (ключ ctx: `worktrees`)

- `exec(cwd, args, signal?)` — один git-вызов до завершения; exit-факты плюс собранный stdout/stderr. Таймаут и лимиты вывода — из конфигурации сервиса.
- `resolveCommit(repoPath, ref)` — `rev-parse --verify <ref>^{commit}`; полный sha базового коммита фанлаута.
- `create(spec)` — `git worktree add -b <branch> <path> [<baseRef>]`; новая ветка от базового ref. Провал (существующая ветка, занятый каталог) оставляет репозиторий без изменений.
- `list(repoPath)` — `git worktree list --porcelain`, разбор в записи; главное рабочее дерево — первый элемент.
- `remove(spec)` — `git worktree remove [--force] <path>` плюс опциональный `git branch -D` для ветки попытки.
- `diff(worktreePath, baseRef, signal?)` — `merge-base baseRef HEAD`, затем `--stat` и унифицированный diff рабочего дерева (зафиксированные и незафиксированные изменения трекаемых файлов); новые (untracked) файлы дописываются в `--stat` строками `(untracked) <path>` — индекс worktree не мутирует.
- `mergeBranch(repoPath, branch, signal?)` — `git merge --no-edit`; конфликтный или упавший merge откатывается (`git merge --abort`), классификация (`merged`/`up-to-date`/`conflict`/`error`) и объединённый вывод возвращаются вызывающему.

## Конфигурация

| ключ | значение по умолчанию | смысл |
|---|---|---|
| `command` | `git` | исполняемый файл git (имя из PATH или абсолютный путь). |
| `timeoutMs` | `60000` | таймаут одного вызова. |
| `maxOutputBytes` | `1000000` | потолок собираемого вывода на поток. |
| `graceMs` | `5000` | SIGTERM→SIGKILL для зависшего git-потомка. |

## Model Experience

### Сервис git-worktree

#### What the model sees

Ничего: пакет не регистрирует инструментов, промптов и сессионных событий; `ctx.worktrees` обслуживает только хостовых потребителей (`dsh-fleet` и его инструменты).

#### Token effect

Нулевой: ни один запрос не несёт текст из этого пакета.

#### KV Cache effect

Независим от запросов: пакет не касается префикса запроса и не может инвалилидировать кэш провайдера.

## Known Limitations and Deferred Work

- Разбор porcelain без `-z`: пути с переводами строк не представимы в формате `worktree list --porcelain` старых git и проявятся как ошибка разбора; переход на `-z` отложен до фиксации минимальной версии git.
- Провайдер один: разделение Service Definition и удалённого провайдера (SSH/E2B worktree) отложено до появления второго потребителя execution world.
- `mergeBranch` выполняет только `--no-edit` merge: rebase-стратегия, octopus и выбор автора сообщения — вне контракта.
