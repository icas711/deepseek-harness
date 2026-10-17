/**
 * Юнит-тесты окна вывода: удержание хвоста, offset-семантика и lossy-флаг.
 */

import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { OutputWindow } from '../src/window.ts'

describe('OutputWindow', () => {
  it('удерживает хвост и роняет голову при переполнении', () => {
    const window = new OutputWindow(10)
    window.push(Buffer.from('0123456789'))
    expect(window.text()).toBe('0123456789')
    window.push(Buffer.from("abc"))
    expect(window.text()).toBe('3456789abc')
    expect(window.truncated).toBe(true)
    expect(window.totalBytes).toBe(13)
  })

  it('readFrom отдаёт дельту со смещением и честно ставит lossy', () => {
    const window = new OutputWindow(4)
    window.push(Buffer.from('abcdef'))
    // Голова (ab) выпала; чтение с 0 lossy, читается удержанный хвост.
    const first = window.readFrom(0)
    expect(first.lossy).toBe(true)
    expect(first.text).toBe('cdef')
    expect(first.nextOffset).toBe(6)
    // Чтение с актуального смещения — пустая дельта без потери.
    const second = window.readFrom(6)
    expect(second).toEqual({ text: '', nextOffset: 6, lossy: false })
  })

  it('многобайтовые границы UTF-8 не рвут окно: байтовая семантика', () => {
    const window = new OutputWindow(100)
    window.push(Buffer.from('привет', 'utf8'))
    expect(window.text()).toBe('привет')
    expect(window.readFrom(0).text).toBe('привет')
  })
})
