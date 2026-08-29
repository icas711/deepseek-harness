/**
 * Browser half of the browse directory-picker backend: fills ui-workspace's
 * two directory-flow holes with the in-app Select Workspace Directory dialog
 * (figma `Harness` 813-23126 family), driving the node half's
 * `host.listDirectory`/`host.createDirectory` primitives. Mounting this
 * package therefore composes both sides of the browse interaction with one
 * cordis.yml row; no client code branches on a capability kind. The dialog's
 * copy is locale-registered here — the flow package owns its own strings.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { BrowseFlowInjected } from './flow.ts'
import { BrowseDirectoryFlow } from './flow.ts'

/** Locale namespace owning the browser dialog's copy. */
const LOCALE_NS = 'directory-browser'

/** Required services (cordis fiber inject): the slot registry, the wire-facing workspace service, and locale. */
export const inject = ['slots', 'workspaces', 'locale']

/**
 * Client plugin body: register the dialog's dictionaries and the browse flow
 * into both directory-flow holes through `slots.inject()` because the
 * ui-workspace entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    // The dialog's copy: registration is transactional — a rival owner of
    // the namespace makes the register throw, and the failed activation
    // leaves no half-installed dictionary behind.
    const ruDict = {
      'browser.title': 'Выберите каталог рабочей области',
      'browser.home': 'Домашний каталог',
      'browser.newFolder': 'Новая папка',
      'browser.folderName': 'Имя папки',
      'browser.createIn': 'Новая папка в «{name}»',
      'browser.untitledFolder': 'Безымянная папка',
      'browser.create': 'Создать',
      'browser.cancel': 'Отмена',
      'browser.open': 'Открыть',
      'browser.editPath': 'Изменить путь',
      'browser.loading': 'Загрузка…',
      'browser.truncated': 'Слишком много папок; показано только начало.',
      'browser.showHidden': 'Показывать скрытые файлы',
    }
    const dispose = ctx.locale.register(LOCALE_NS, ruDict)
    return () => { dispose() }
  }, 'directory-picker-browse: dialog dictionaries')

  const injected = (): BrowseFlowInjected => ({
    listDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
    createDirectory: (path, name) => ctx.workspaces.createDirectory(path, name),
    t: ctx.locale.bind(LOCALE_NS),
  })
  // Both declaration lifetimes must be live before the pair installs; the
  // generator makes the two registrations one transactional effect. The
  // outer/inner nesting order is arbitrary; neither hole has precedence.
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow', inject: injected,
      }, BrowseDirectoryFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow', inject: injected,
      }, BrowseDirectoryFlow)
    }))
}
