/**
 * The system-tray presence for `dsh web`: one icon whose menu starts and
 * stops the web server (the process and the icon stay alive, so the browser
 * surfaces the stop as a connection loss) and exits the process through the
 * launcher's bounded exit. The native helper ships inside the systray2
 * package; when it cannot run — a headless machine, a missing binary — the
 * tray degrades to a logged no-op and the server lifecycle stays reachable
 * through the command line.
 * @module @deepseek-ai/dsh-web-app/tray
 */

import systray2 from 'systray2'
import type { Menu, MenuItem } from 'systray2'
import { TRAY_ICON_BASE64 } from './tray-icon.ts'

/**
 * systray2 compiles to CJS with the class on `exports.default`; under plain
 * Node ESM the default import is the whole `module.exports`, so the
 * constructor is resolved off the wrapper with a whole-module fallback for
 * alternative packagings.
 * @returns the systray2 constructor.
 */
export function resolveSysTray(): SysTrayCtor {
  return (systray2 as { default?: SysTrayCtor }).default ?? (systray2 as unknown as SysTrayCtor)
}

type SysTrayCtor = (new (config: { menu: Menu }) => NativeTray) & { separator: MenuItem }
const SysTray: SysTrayCtor = resolveSysTray()

/** The three menu actions the tray answers. */
export interface TrayActions {
  /** Start the web server (a no-op on the server side when already listening). */
  onStart(): void
  /** Stop the web server without touching the process. */
  onStop(): void
  /** Exit the whole process through the launcher's bounded exit. */
  onExit(): void
}

/** The tray face the glue plugin owns: push running state, dispose the icon. */
export interface TrayHandle {
  /** Flip the menu to the server state; converges on repeats. */
  setRunning(running: boolean): void
  /** Remove the icon; the node process itself keeps running. */
  close(): Promise<void>
}

/** The minimal native surface this module drives (systray2's instance satisfies it). */
export interface NativeTray {
  sendAction(action: { type: 'update-item'; item: MenuItem }): Promise<unknown>
  onClick(listener: (event: { item: MenuItem }) => void): Promise<unknown>
  kill(exitNode?: boolean): Promise<void>
}

/** Menu titles double as click identities; stable constants, single dictionary here. */
export const START_TITLE = 'Запустить'
/** See {@link START_TITLE}. */
export const STOP_TITLE = 'Остановить'
/** See {@link START_TITLE}. */
export const EXIT_TITLE = 'Выйти'

/**
 * The menu for one server state: exactly the actionable verb is enabled, so
 * the icon itself answers "is the server up?" without a submenu.
 * @param running - whether the web server is listening.
 * @returns the menu items.
 */
export function trayMenu(running: boolean): MenuItem[] {
  return [
    { title: START_TITLE, tooltip: START_TITLE, enabled: !running },
    { title: STOP_TITLE, tooltip: STOP_TITLE, enabled: running },
    { ...SysTray.separator },
    { title: EXIT_TITLE, tooltip: EXIT_TITLE, enabled: true },
  ]
}

/**
 * Mount the tray icon. Every failure of the native helper — spawn refusal,
 * lost stdio protocol — degrades to a logged no-op: the tray is a convenience,
 * never a boot dependency.
 * @param actions - the three verbs the menu forwards to.
 * @param spawnTray - the native surface factory (tests substitute a fake).
 * @returns the handle, or undefined when the tray is unavailable.
 */
export function installTray(
  actions: TrayActions,
  spawnTray: (menu: Menu) => NativeTray = menu => new SysTray({ menu }) as NativeTray,
): TrayHandle | undefined {
  let running = false
  let native: NativeTray
  try {
    native = spawnTray({
      icon: TRAY_ICON_BASE64,
      title: 'custom-harness',
      tooltip: 'custom-harness',
      items: trayMenu(running),
    })
  } catch (error) {
    console.log(`dsh web: tray icon unavailable (${error instanceof Error ? error.message : String(error)}); continuing without it`)
    return undefined
  }
  void native.onClick((event) => {
    if (event.item.title === START_TITLE) actions.onStart()
    else if (event.item.title === STOP_TITLE) actions.onStop()
    else if (event.item.title === EXIT_TITLE) actions.onExit()
  }).catch((error: unknown) => {
    console.log(`dsh web: tray menu unavailable (${error instanceof Error ? error.message : String(error)}); continuing without it`)
  })
  const degrade = (what: string, error: unknown): void => {
    console.log(`dsh web: tray ${what} failed (${error instanceof Error ? error.message : String(error)})`)
  }
  return {
    setRunning(next: boolean): void {
      if (running === next) return
      running = next
      for (const item of trayMenu(running)) {
        void native.sendAction({ type: 'update-item', item }).catch((error: unknown) => { degrade('menu update', error) })
      }
    },
    async close(): Promise<void> {
      // exitNode false: the node process owns its own lifetime (appExit).
      await native.kill(false).catch((error: unknown) => { degrade('exit', error) })
    },
  }
}
