/**
 * Чип «Сервер / Станция ⟨имя⟩» (слот conversation.hero.executionTarget):
 * отложенный выбор исполнения для следующей сессии с этого экрана. Пустой
 * список станций — пункт задизейблен с подсказкой про dsh-station pair;
 * недоступный мост станций — чип не рендерится вовсе.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { stagedName } from '../execution-target-store.ts'
import type { ExecutionTargetController, ExecutionTargetState } from '../execution-target-store.ts'
import css from './ExecutionTargetChip.module.css'

/** Внедряемые зависимости чипа (слот inject). */
export interface ExecutionTargetChipInjected {
  /** Контроллер пикера: список и отложенный выбор. */
  controller: ExecutionTargetController
  /** uSES-подписка на снимок пикера. */
  useExecutionTarget: SnapshotSelectorHook<ExecutionTargetState>
}

/** Полные пропы чипа: inject + словарь разговора. */
export type ExecutionTargetChipProps = ExecutionTargetChipInjected & PropsLocale<'conversation'>

/**
 * Отрисовать чип выбора исполнения.
 * @param props - контроллер, словарь.
 * @returns чип с меню; null при недоступном мосте станций.
 */
export function ExecutionTargetChip(props: ExecutionTargetChipProps): ReactNode {
  const state = props.useExecutionTarget(s => s)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  // Список читается один раз при первом рендере чипа; отказ транспорта
  // (обрыв, неполная подстановка в тестах) не рвёт композицию экрана — чип
  // остаётся на «Сервер», повторная попытка при следующем монтировании.
  useEffect(() => {
    if (state.status === 'idle') {
      void props.controller.load().catch(() => { /* список недоступен: остаёмся на «Сервер» */ })
    }
  }, [props.controller, state.status])
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node && rootRef.current.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [open])
  // Моста станций нет в развёртывании — выбора нет, чип не нужен.
  if (state.unavailable) return null
  const name = stagedName(state)
  const label = name === undefined ? props.t('executionTarget.server') : props.t('executionTarget.station', { name })
  return (
    <span className={css.anchor} ref={rootRef}>
      <button
        type="button"
        className={css.chip}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.t('executionTarget.label')}
        onClick={() => { setOpen(value => !value) }}
      >
        {label}
      </button>
      {open && (
        <span className={css.menu} role="listbox" aria-label={props.t('executionTarget.label')}>
          <button
            type="button"
            role="option"
            aria-selected={state.staged === undefined}
            className={clsx(css.item, state.staged === undefined && css.selected)}
            onClick={() => {
              props.controller.stage(undefined)
              setOpen(false)
            }}
          >
            {state.staged === undefined && <IconCheckOutline16 size={14} />}
            {props.t('executionTarget.server')}
          </button>
          {state.stations.map(station => (
            <button
              key={station.stationId}
              type="button"
              role="option"
              aria-selected={state.staged === station.stationId}
              className={clsx(css.item, state.staged === station.stationId && css.selected)}
              onClick={() => {
                props.controller.stage(station.stationId)
                setOpen(false)
              }}
            >
              <span
                className={clsx(css.dot, station.online && css.online)}
                aria-hidden
                title={station.online ? props.t('executionTarget.online') : props.t('executionTarget.offline')}
              />
              {props.t('executionTarget.station', { name: station.name })}
              {state.staged === station.stationId && <IconCheckOutline16 size={14} />}
            </button>
          ))}
          {state.status === 'ready' && state.stations.length === 0 && (
            <button type="button" className={css.item} disabled>
              {props.t('executionTarget.empty')}
            </button>
          )}
          {state.stations.length > 0 && (
            <span className={css.hint}>{props.t('executionTarget.pairHint')}</span>
          )}
        </span>
      )}
    </span>
  )
}
