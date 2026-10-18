/**
 * Долговременный реестр станций: документ `station-registry.json`, строгий
 * разбор на границе носителя и хранилище в памяти процесса. Каждая мутация
 * перерисовывает весь документ и коммитит его через writer-lock атомарной
 * записи, так что читатели видят только целое старое или целое новое
 * содержимое (шаблон — реестр задач dsh-task-supervisor).
 * @module @deepseek-ai/dsh-stations/registry
 */

import { readFile } from 'node:fs/promises'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { StationId } from '@deepseek-ai/dsh-station-protocol'
import type { StationRecord } from './types.ts'

/** Версия формата документа, прошитая в каждую запись и проверяемая при загрузке. */
export const REGISTRY_FORMAT_VERSION = 1

/** Платформы, допускаемые форматом; всё остальное — громкий отказ. */
const PLATFORMS: readonly StationRecord['platform'][] = ['win32', 'darwin', 'linux']

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Документ реестра не разобрался. Рендерится как отказ загрузки с
 * подсказкой оператору: битый долговременный реестр громко падает,
 * а не замалчивается и не затирается.
 */
export class RegistryFileError extends Error {
  /**
   * Собирает одну ошибку разбора.
   * @param filePath - документ, который не удалось разобрать.
   * @param reason - конкретная причина нарушения формата.
   */
  constructor(filePath: string, reason: string) {
    super(`stations: не удалось прочитать реестр станций "${filePath}" (${reason}); ` +
      'исправьте или удалите файл — удаление отзывает все станции развёртывания')
    this.name = 'RegistryFileError'
  }
}

/** Форма документа на диске. */
interface RegistryDocument {
  version: typeof REGISTRY_FORMAT_VERSION
  stations: StationRecord[]
}

/**
 * Разбирает документ реестра на границе носителя. Каждое поле проверяется;
 * неизвестные платформы, дубликаты станций и чужая версия падают громко.
 * @param text - полное содержимое файла.
 * @param filePath - путь документа, называется в ошибках.
 * @returns разобранные записи станций.
 * @throws RegistryFileError при любом нарушении структуры.
 */
export function parseRegistryDocument(text: string, filePath: string): StationRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new RegistryFileError(filePath, `не JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RegistryFileError(filePath, 'документ не является реестром станций')
  }
  const doc = parsed as { version?: unknown; stations?: unknown }
  if (doc.version !== REGISTRY_FORMAT_VERSION) {
    throw new RegistryFileError(filePath, `ожидается версия ${REGISTRY_FORMAT_VERSION}, получена ${String(doc.version)}`)
  }
  if (!Array.isArray(doc.stations)) {
    throw new RegistryFileError(filePath, 'stations должен быть массивом')
  }
  const seen = new Set<string>()
  return doc.stations.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new RegistryFileError(filePath, `stations[${index}] не является записью`)
    }
    const record = entry as Record<string, unknown>
    for (const field of ['stationId', 'login', 'name', 'rootPath', 'platform', 'tokenHash', 'createdAt', 'lastSeenAt'] as const) {
      if (record[field] === undefined) {
        throw new RegistryFileError(filePath, `stations[${index}] lacks "${field}"`)
      }
    }
    for (const field of ['stationId', 'login', 'name', 'rootPath', 'tokenHash'] as const) {
      if (typeof record[field] !== 'string' || (record[field]).length === 0) {
        throw new RegistryFileError(filePath, `stations[${index}] несёт некорректное поле "${field}"`)
      }
    }
    if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)
      || typeof record.lastSeenAt !== 'number' || !Number.isFinite(record.lastSeenAt)) {
      throw new RegistryFileError(filePath, `stations[${index}] несёт некорректные метки времени`)
    }
    if (!PLATFORMS.includes(record.platform as StationRecord['platform'])) {
      throw new RegistryFileError(filePath, `stations[${index}] несёт неизвестную платформу ${JSON.stringify(String(record.platform))}`)
    }
    const stationId = String(record.stationId)
    if (seen.has(stationId)) {
      throw new RegistryFileError(filePath, `stations[${index}] повторяет идентификатор ${stationId}`)
    }
    seen.add(stationId)
    return {
      stationId: StationId(stationId),
      login: String(record.login),
      name: String(record.name),
      rootPath: String(record.rootPath),
      platform: record.platform as StationRecord['platform'],
      tokenHash: String(record.tokenHash),
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
    }
  })
}

/**
 * Рисует полный следующий документ. Двухпробельная согласованность
 * оставляет файл человекочитаемым при диффе; завершающий перевод строки
 * совпадает с файловым гейтом репозитория.
 * @param stations - все записи в порядке хранилища.
 * @returns полное содержимое файла для коммита.
 */
export function serializeRegistryDocument(stations: readonly StationRecord[]): string {
  const doc: RegistryDocument = { version: REGISTRY_FORMAT_VERSION, stations: [...stations] }
  return `${JSON.stringify(doc, null, 2)}\n`
}

/** Опции хранилища; `now` — тестовые фальшивые часы. */
export interface StationRegistryStoreOptions {
  /** Путь документа реестра (в композициях — путь dsh-home). */
  readonly filePath: string
  /** Источник wall-clock; по умолчанию Date.now. */
  readonly now?: () => number
}

/**
 * Хранилище-владелец записей станций, зеркалируемое в долговременный
 * документ. Память ведёт: мутация применяется к карте и затем коммитит
 * перезапись целого документа под writer-lock, так что два процесса
 * с общим домом сливаются по stationId вместо затирания друг друга.
 */
export class StationRegistryStore {
  private readonly records = new Map<string, StationRecord>()
  private readonly filePath: string
  private readonly now: () => number

  /**
   * Строит хранилище без обращения к файлу; чтение делает {@link load}.
   * @param options - путь документа и опциональные часы.
   */
  constructor(options: StationRegistryStoreOptions) {
    this.filePath = options.filePath
    this.now = options.now ?? Date.now
  }

  /**
   * Читает долговременный документ в память. Отсутствующий файл — пустой
   * реестр; присутствующий, но неверный — громкий отказ загрузки.
   * @throws RegistryFileError, когда документ существует и неверен.
   */
  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      return
    }
    for (const record of parseRegistryDocument(text, this.filePath)) {
      this.records.set(String(record.stationId), record)
    }
  }

  /** @returns свежие копии всех записей, в порядке вставки. */
  snapshot(): StationRecord[] {
    return [...this.records.values()].map(record => ({ ...record }))
  }

  /**
   * @param stationId - идентификатор станции.
   * @returns свежую копию записи или undefined.
   */
  get(stationId: string): StationRecord | undefined {
    const record = this.records.get(stationId)
    return record === undefined ? undefined : { ...record }
  }

  /**
   * Добавляет запись сопряжённой станции и коммитит документ.
   * @param input - поля новой записи без меток времени.
   * @returns закоммиченную запись.
   */
  async add(input: Omit<StationRecord, 'createdAt' | 'lastSeenAt'>): Promise<StationRecord> {
    const record: StationRecord = { ...input, createdAt: this.now(), lastSeenAt: this.now() }
    this.records.set(String(record.stationId), record)
    try {
      await this.commit()
    } catch (error) {
      this.records.delete(String(record.stationId))
      throw error
    }
    return { ...record }
  }

  /**
   * Обновляет метку последнего выхода на связь и коммитит документ.
   * @param stationId - станция, которая вышла на связь.
   * @returns закоммиченную запись.
   * @throws Error, когда станция неизвестна реестру.
   */
  async touch(stationId: string): Promise<StationRecord> {
    const previous = this.records.get(stationId)
    if (previous === undefined) throw new Error(`stations: станция ${stationId} неизвестна реестру`)
    const record: StationRecord = { ...previous, lastSeenAt: this.now() }
    this.records.set(stationId, record)
    try {
      await this.commit()
    } catch (error) {
      this.records.set(stationId, previous)
      throw error
    }
    return { ...record }
  }

  /**
   * Коммитит карту памяти как объединение с документом на диске. Writer-lock
   * сериализует межпроцессные циклы «чтение-изменение-запись»; атомарная
   * замена держит каждого читателя на целом содержимом. Чужой документ,
   * не прошедший разбор, валит запись громко — та же позиция, что у {@link load}.
   */
  private async commit(): Promise<void> {
    await withFileLock(this.filePath, async () => {
      let disk: StationRecord[]
      try {
        disk = parseRegistryDocument(await readFile(this.filePath, 'utf8'), this.filePath)
      } catch (error) {
        if (!isENOENT(error)) throw error
        disk = []
      }
      const merged = new Map<string, StationRecord>()
      for (const record of disk) merged.set(String(record.stationId), record)
      for (const record of this.records.values()) merged.set(String(record.stationId), record)
      // 0600/0700: реестр несёт хэши токенов и пути машин пользователей.
      await writeFileAtomic(this.filePath, serializeRegistryDocument([...merged.values()]), { mode: 0o600, dirMode: 0o700 })
    })
  }
}
