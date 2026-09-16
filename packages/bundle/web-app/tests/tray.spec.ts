import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Menu, MenuItem } from 'systray2'
import {
  EXIT_TITLE, installTray, resolveSysTray, START_TITLE, STOP_TITLE, trayMenu, type NativeTray, type TrayActions,
} from '../src/tray.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

/** A fake native surface capturing menu updates, clicks, and the kill. */
function fakeTray(failures: { onClick?: boolean; sendAction?: boolean } = {}) {
  const sent: MenuItem[] = []
  let clicks: ((event: { item: MenuItem }) => void) | undefined
  let killed: boolean | undefined
  const native: NativeTray = {
    sendAction: async (action) => {
      if (failures.sendAction) throw new Error('stdio pipe broke')
      sent.push(action.item)
    },
    onClick: async (listener) => {
      if (failures.onClick) throw new Error('helper died before listening')
      clicks = listener
      return native
    },
    kill: async (exitNode?: boolean) => { killed = exitNode },
  }
  return {
    native,
    sent,
    killed: () => killed,
    click: (item: Partial<MenuItem>) => clicks?.({ item: { title: '', tooltip: '', ...item } }),
  }
}

/** Mount with a fake native surface, recording the actions each verb fires. */
function mount(failures?: Parameters<typeof fakeTray>[0]) {
  const fired: string[] = []
  const actions: TrayActions = {
    onStart: () => { fired.push('start') },
    onStop: () => { fired.push('stop') },
    onExit: () => { fired.push('exit') },
  }
  const fake = fakeTray(failures)
  const menus: Menu[] = []
  const tray = installTray(actions, (menu) => {
    menus.push(menu)
    return fake.native
  })
  return { tray, fake, fired, menus }
}

describe('trayMenu', () => {
  it('enables exactly the actionable verb for the server state', () => {
    const stopped = trayMenu(false)
    const running = trayMenu(true)
    expect(stopped.find(item => item.title === START_TITLE)?.enabled).toBe(true)
    expect(stopped.find(item => item.title === STOP_TITLE)?.enabled).toBe(false)
    expect(running.find(item => item.title === START_TITLE)?.enabled).toBe(false)
    expect(running.find(item => item.title === STOP_TITLE)?.enabled).toBe(true)
    expect(running.find(item => item.title === EXIT_TITLE)?.enabled).toBe(true)
  })
})

describe('resolveSysTray', () => {
  it('resolves the real CJS package to a constructible class', () => {
    // The package puts the class on `exports.default`; a wrapper-shape change
    // (or losing the interop) used to surface only as an installed-app
    // degrade, because every other test injects a fake surface.
    expect(typeof resolveSysTray()).toBe('function')
  })
})

describe('installTray', () => {
  it('mounts the icon with the stopped-state menu and forwards clicks by title', async () => {
    const { tray, fake, fired, menus } = mount()
    expect(menus).toHaveLength(1)
    expect(menus[0]?.title).toBe('custom-harness')
    fake.click({ title: STOP_TITLE })
    fake.click({ title: START_TITLE })
    fake.click({ title: EXIT_TITLE })
    fake.click({ title: 'незнакомый пункт' })
    expect(fired).toEqual(['stop', 'start', 'exit'])
    await tray?.close()
    expect(fake.killed()).toBe(false)
  })

  it('pushes the menu to the new state and converges on repeats', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { tray, fake } = mount()
    tray?.setRunning(true)
    await Promise.resolve()
    tray?.setRunning(true)
    const pushed = fake.sent.filter(item => item.title === STOP_TITLE)
    expect(pushed).toHaveLength(1)
    expect(pushed[0]?.enabled).toBe(true)
    expect(log).not.toHaveBeenCalled()
    tray?.setRunning(false)
    await Promise.resolve()
    expect(fake.sent.filter(item => item.title === START_TITLE).at(-1)?.enabled).toBe(true)
  })

  it('degrades to undefined with a log when the native helper cannot spawn', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const tray = installTray({ onStart: () => {}, onStop: () => {}, onExit: () => {} }, () => {
      throw new Error('no display')
    })
    expect(tray).toBeUndefined()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('tray icon unavailable (no display)'))
  })

  it('degrades with a log when the click listener is refused', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    installTray({ onStart: () => {}, onStop: () => {}, onExit: () => {} }, () => fakeTray({ onClick: true }).native)
    await vi.waitFor(() => {
      expect(log).toHaveBeenCalledWith(expect.stringContaining('tray menu unavailable (helper died before listening)'))
    })
  })

  it('logs and continues when a menu update breaks', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { tray } = mount({ sendAction: true })
    tray?.setRunning(true)
    await vi.waitFor(() => {
      expect(log).toHaveBeenCalledWith(expect.stringContaining('tray menu update failed (stdio pipe broke)'))
    })
  })
})
