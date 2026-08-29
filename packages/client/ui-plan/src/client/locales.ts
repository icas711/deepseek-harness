/** `plan` namespace dictionary (the composer plan chip's copy). */

/** The plan namespace key union. */
export type PlanKey = keyof typeof ru

/** Russian dictionary (the key-set source of truth; the only shipped locale). */
export const ru = {
  'chip.on.aria': 'Режим плана включён, нажмите, чтобы выключить',
  'chip.on.title': 'Режим плана включён — нажмите, чтобы выключить (/plan off)',
  'chip.off.aria': 'Режим плана выключен, нажмите, чтобы включить',
  'chip.off.title': 'Режим плана выключен — нажмите, чтобы включить (/plan)',
} satisfies Record<string, string>
