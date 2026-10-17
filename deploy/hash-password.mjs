#!/usr/bin/env node
/**
 * Генератор записи для DSH_WEB_USERS: спрашивает пароль (дважды, без эха в
 * терминале) и печатает готовую строку DSH_WEB_USERS='логин:хэш'. Без
 * зависимостей — только Node.js 22+; формат совпадает с веб-сервером
 * аутентификации форка.
 *
 *   node deploy/hash-password.mjs alice
 *   node deploy/hash-password.mjs alice 'пароль'   # для скриптов: без вопросов
 *
 * Печатную строку вставьте в deploy/.env ЦЕЛИКОМ, вместе с одинарными
 * кавычками: compose разворачивает $ в значениях .env и без кавычек молча
 * портит scrypt-хэш, принимая $16384 и $8 за переменные. Несколько
 * пользователей — запустите генератор по разу на каждого и перечислите
 * записи через запятую внутри одних кавычек.
 */

import { randomBytes, scryptSync } from 'node:crypto'

const N = 16384
const R = 8
const P = 1
const KEYLEN = 32

const login = process.argv[2]
if (login === undefined || !/^[A-Za-z0-9._-]{1,64}$/.test(login)) {
  console.error('Использование: node hash-password.mjs <логин> [пароль]')
  console.error('Логин: 1–64 символа, латиница, цифры, точка, дефис, подчёркивание.')
  process.exit(1)
}

/** Прочитать строку с терминала; в raw-режиме символы не показываются. */
function readLine(prompt) {
  return new Promise((resolve) => {
    process.stderr.write(prompt)
    let line = ''
    const finish = () => {
      process.stdin.removeListener('data', onData)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
        process.stderr.write('\n')
      }
      resolve(line)
    }
    const onData = (chunk) => {
      const text = chunk.toString('utf8')
      for (const char of text) {
        if (char === '\n' || char === '\r') return finish()
        if (char === '\u0003') {
          process.stderr.write('\n')
          process.exit(1)
        }
        if (char === '\u007f' || char === '\b') line = line.slice(0, -1)
        else line += char
      }
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.on('data', onData)
    process.stdin.resume()
  })
}

const password = process.argv[3] ?? await (async () => {
  if (!process.stdin.isTTY) {
    console.error('Неинтерактивный запуск: передайте пароль вторым аргументом.')
    process.exit(1)
  }
  const first = await readLine('Пароль: ')
  const second = await readLine('Ещё раз: ')
  if (first !== second) {
    console.error('Пароли не совпали.')
    process.exit(1)
  }
  if (first.length < 8) {
    console.error('Пароль короче 8 символов — выберите подлиннее.')
    process.exit(1)
  }
  return first
})()

const salt = randomBytes(16)
const key = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 })
process.stdout.write(`DSH_WEB_USERS='${login}:scrypt$${String(N)}$${String(R)}$${String(P)}$${salt.toString('hex')}$${key.toString('hex')}'\n`)
