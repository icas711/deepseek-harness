/**
 * Юнит-тесты каркаса протокола: круговорот кадров через декодер, отказ
 * чужих версий и неизвестных дискриминантов, изоляция путей на обеих
 * платформенных ветках и канонизация realpath против обхода корня через
 * символьную ссылку.
 */

import { describe, expect, it } from 'vitest'
import {
  PAIRING_CODE_LENGTH,
  STATION_PROTOCOL_VERSION,
  STATION_WS_PATH,
  assertNever,
  decodeStationFrame,
  decodeStationText,
  mintPairingCode,
  realpathWithinRoot,
  resolveWithinRoot,
  StationPathError,
  StationProtocolError,
} from '../src/index.ts'

function pairHello() {
  return {
    t: 'hello' as const,
    version: STATION_PROTOCOL_VERSION,
    auth: { mode: 'pair' as const, code: 'abcd2345', stationName: 'ноутбук', rootPath: 'C:\\work', platform: 'win32' as const },
  }
}

describe('mintPairingCode', () => {
  it('минтует код нужной длины из безопасного алфавита', () => {
    let call = 0
    const code = mintPairingCode(() => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8 + (call++)]))
    expect(code).toHaveLength(PAIRING_CODE_LENGTH)
    expect(code).toMatch(/^[23456789bcdghjkmnpqrstvwxz]+$/)
  })
})

describe('decodeStationFrame', () => {
  it('пропускает кадр сопряжения и сохраняет типизированную полезную нагрузку', () => {
    const frame = decodeStationFrame(pairHello())
    expect(frame.t).toBe('hello')
    if (frame.t !== 'hello' || frame.auth.mode !== 'pair') throw new Error('не сузилось')
    expect(frame.auth.rootPath).toBe('C:\\work')
    expect(frame.auth.platform).toBe('win32')
  })

  it('отвергает чужую версию протокола', () => {
    expect(() => decodeStationFrame({ ...pairHello(), version: STATION_PROTOCOL_VERSION + 1 }))
      .toThrow(StationProtocolError)
    expect(() => decodeStationFrame({ ...pairHello(), version: '1' })).toThrow(StationProtocolError)
  })

  it('отвергает неизвестные дискриминанты, операции и события', () => {
    expect(() => decodeStationFrame({ t: 'boom' })).toThrow(/неизвестный дискриминант/)
    expect(() => decodeStationFrame({ t: 'req', id: 'x', op: 'fs/format', p: {} })).toThrow(/неизвестная операция/)
    expect(() => decodeStationFrame({ t: 'evt', event: 'proc/teleport', p: {} })).toThrow(/неизвестное событие/)
    expect(() => decodeStationFrame({ t: 'res', id: 'x', ok: 'да' })).toThrow(/поле ok обязательно/)
  })

  it('отвергает нарушенные полезные нагрузки операций', () => {
    expect(() => decodeStationFrame({ t: 'req', id: 'x', op: 'fs/stat', p: {} })).toThrow(/path/)
    expect(() => decodeStationFrame({ t: 'req', id: 'x', op: 'fs/read', p: { path: 'a', maxBytes: 'много' } }))
      .toThrow(/maxBytes/)
    expect(() => decodeStationFrame({ t: 'req', id: 'x', op: 'proc/spawn', p: { id: 'p', argv: [1], cwd: 'c', stdin: { mode: 'pipe' }, stdoutInherit: false, stderrInherit: false } }))
      .toThrow(/argv/)
    expect(() => decodeStationFrame({ t: 'req', id: '', op: 'fs/stat', p: { path: 'a' } })).toThrow(/id корреляции/)
    expect(() => decodeStationText('не json')).toThrow(StationProtocolError)
  })

  it('круговорот: кодированный кадр читается обратно с сохранением типов', () => {
    const frame = decodeStationFrame({
      t: 'res',
      id: 'r1',
      ok: false,
      error: { code: 'denied', message: 'путь вне корня' },
    })
    if (frame.t !== 'res' || frame.ok) throw new Error('не сузилось')
    expect(frame.error.code).toBe('denied')
    const event = decodeStationFrame({ t: 'evt', event: 'proc/exit', p: { id: 'p1', exitCode: null, signal: 'SIGTERM' } })
    if (event.t !== 'evt' || event.event !== 'proc/exit') throw new Error('не сузилось')
    expect(event.p.signal).toBe('SIGTERM')
  })

  it('assertNever роняет недостижимую ветку', () => {
    expect(() => assertNever('невозможно' as never)).toThrow(/закрытого юниона/)
  })
})

describe('resolveWithinRoot', () => {
  it('posix: пропускает внутренние пути и отвергает выход за корень', () => {
    expect(resolveWithinRoot('/home/u/root', 'a/b.txt', 'darwin')).toBe('/home/u/root/a/b.txt')
    expect(resolveWithinRoot('/home/u/root', '/home/u/root/x', 'linux')).toBe('/home/u/root/x')
    expect(() => resolveWithinRoot('/home/u/root', '../зло', 'linux')).toThrow(StationPathError)
    expect(() => resolveWithinRoot('/home/u/root', '/etc/passwd', 'linux')).toThrow(StationPathError)
    expect(() => resolveWithinRoot('/home/u/root', 'a\0b', 'linux')).toThrow(StationPathError)
    // Трюк с префиксом: /home/u/root-evil не внутри /home/u/root.
    expect(() => resolveWithinRoot('/home/u/root', '/home/u/root-evil/x', 'linux')).toThrow(StationPathError)
  })

  it('win32: сравнивает регистронезависимо и держит чужие диски снаружи', () => {
    expect(resolveWithinRoot('C:\\Работа', 'под\\файл.txt', 'win32')).toBe('C:\\Работа\\под\\файл.txt')
    // Регистр результата следует за написанием вызывающего: путь тот же,
    // сравнение с корнем регистронезависимо.
    expect(resolveWithinRoot('C:\\Работа', 'c:\\работа\\Х', 'win32')).toBe('c:\\работа\\Х')
    expect(() => resolveWithinRoot('C:\\Работа', 'D:\\зло', 'win32')).toThrow(StationPathError)
    expect(() => resolveWithinRoot('C:\\Работа', '..\\зло', 'win32')).toThrow(StationPathError)
  })
})

describe('realpathWithinRoot', () => {
  const posixRealpath = async (path: string): Promise<string> => path.replace('/root/link', '/outside')

  it('posix: отвергает символьную ссылку внутри корня, ведущую наружу', async () => {
    await expect(realpathWithinRoot('/home/u/root', 'link/файл', 'linux', posixRealpath))
      .rejects.toThrow(StationPathError)
  })

  it('posix: канонизирует существующего предка и держит остаток внутри', async () => {
    // Существует только сам корень; он же канонизирован в другое место
    // (перемонтирование), остаток пути ещё не создан.
    const realpath = async (path: string): Promise<string> => {
      if (path === '/home/u/root') return '/mnt/данные'
      throw new Error('ENOENT')
    }
    await expect(realpathWithinRoot('/home/u/root', 'новая/папка/файл', 'linux', realpath))
      .resolves.toBe('/mnt/данные/новая/папка/файл')
  })

  it('posix: честно отказывает, когда канонизировать нечего (том отсутствует)', async () => {
    const realpath = async (): Promise<string> => {
      throw new Error('ENOENT')
    }
    await expect(realpathWithinRoot('/home/u/root', 'файл', 'linux', realpath)).rejects.toThrow(StationPathError)
  })
})

describe('константы протокола', () => {
  it('путь upgrade-маршрута фиксирован контрактом', () => {
    expect(STATION_WS_PATH).toBe('/station-ws')
  })
})
