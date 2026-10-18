/**
 * Окно собираемого вывода одного потока процесса: хвост байтов с
 * целостримыми смещениями. Смещения — координаты вызывающего (шов
 * subprocess), потерянный хвост головой помечается lossy.
 * @module @deepseek-ai/dsh-subprocess-station/window
 */

import { Buffer } from 'node:buffer'
import type { SubprocessOutputRead } from '@deepseek-ai/dsh-subprocess'

/** Окно собранного потока: хвост до maxBytes, чтение с любого смещения. */
export class OutputWindow {
  private bytes: Buffer = Buffer.alloc(0)
  /** Целостримовое смещение байта bytes[0] в потоке. */
  private startByte = 0
  private readonly maxBytes: number

  /**
   * Строит окно с потолком удержания.
   * @param maxBytes - сколько хвостовых байтов удерживается в памяти.
   */
  constructor(maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error('subprocess-station: окно вывода требует положительный maxBytes')
    }
    this.maxBytes = maxBytes
  }

  /**
   * Дописывает chunk в окно, при переполнении роняя голову.
   * @param chunk - очередные байты потока.
   */
  push(chunk: Buffer): void {
    this.bytes = this.bytes.length === 0 ? chunk : Buffer.concat([this.bytes, chunk])
    if (this.bytes.length > this.maxBytes) {
      const drop = this.bytes.length - this.maxBytes
      this.bytes = this.bytes.subarray(drop)
      this.startByte += drop
    }
  }

  /**
   * Читает поток с запрошенного смещения (шов subprocess: offset-семантика).
   * @param fromByte - смещение прошлого чтения; 0 — первое чтение.
   * @returns дельта-текст, следующее смещение и признак потери головы.
   */
  readFrom(fromByte: number): SubprocessOutputRead {
    const from = Math.max(0, Math.min(fromByte, this.startByte + this.bytes.length))
    const lossy = from < this.startByte
    const slice = this.bytes.subarray(lossy ? 0 : from - this.startByte)
    return {
      text: slice.toString('utf8'),
      nextOffset: this.startByte + this.bytes.length,
      lossy,
    }
  }

  /** Полное удерживаемое содержимое — итог batch-чтения. */
  text(): string {
    return this.bytes.toString('utf8')
  }

  /** Терялась ли голова потока. */
  get truncated(): boolean {
    return this.startByte > 0
  }

  /** Всего байтов прошло через окно. */
  get totalBytes(): number {
    return this.startByte + this.bytes.length
  }
}
