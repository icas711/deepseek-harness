/** Locale bundles for the agent-preset settings row, hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetCodeName' | 'presetCodeDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** Russian dictionary, checked complete against the key union. */
export const ru: Record<AgentPresetSettingsKey, string> = {
  title: 'Пресет агента',
  description: 'Применяется к сессиям, которые вы создадите с этого момента. Уже запущенные сессии сохраняют свой исходный пресет.',
  loading: 'Загрузка пресетов…',
  error: 'Не удалось загрузить пресеты агента.',
  userTrust: 'Пользовательский',
  seatHint: 'Пресет агента для сессии, которая сейчас будет создана',
  headerHint: 'Пресет агента, на котором работает эта сессия; зафиксирован при её запуске',
  nav: 'Пресеты агентов',
  sectionIntro:
    'Пресет — это набор плагинов, который запускает агент сессии: его инструменты, промпт и возможности. '
    + 'Скопируйте существующий пресет и сделайте его своим или попросите агента подготовить новый в режиме Creator.',
  builtIn: 'Встроенный',
  setDefault: 'Назначить по умолчанию',
  view: 'Просмотр',
  presetStandardName: 'Стандартный режим',
  presetStandardDescription:
    'Полноценный агент для программирования: редактирование файлов, shell, поиск по файлам и в интернете, скиллы, планирование, цели, субагенты и воркфлоу.',
  presetCodeName: 'Режим Code',
  presetCodeDescription:
    'Все возможности стандартного режима: инструменты доступны через Code Mode SDK, чтобы модель могла объединять многошаговые операции в одну программу на TypeScript.',
  presetMinimalName: 'Минимальный режим',
  presetMinimalDescription:
    'Агент для программирования с двумя инструментами: постоянный bash и str_replace_editor.',
  presetCordisName: 'Режим Creator',
  presetCordisDescription:
    'Предназначен для создания собственных пресетов агента: все возможности стандартного режима плюс инспекция рантайма, эксперименты с плагинами и помощь в создании пресетов.',
  duplicate: 'Дублировать',
  duplicateUnavailable: 'В этом развертывании нет каталога пресетов, доступного для записи',
  delete: 'Удалить',
  presetId: 'Идентификатор',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Название',
  displayNamePlaceholder: 'Отображается в списке выбора; по умолчанию — идентификатор',
  inUse: 'Используется',
  builtInGroup: 'Встроенные',
  customGroup: 'Пользовательские',
  noDescription: 'Нет описания.',
  brokenBadge: 'Ошибка загрузки',
  brokenNoCopy: 'Пресет, который не удалось загрузить, нельзя дублировать',
  copyOf: 'Скопировано из',
  composition: 'Состав (agent.cordis.yml)',
  cancel: 'Отмена',
  close: 'Закрыть',
  retry: 'Повторить',
  copyTitle: 'Дублировать пресет',
  copyIntro:
    'Пресет целиком копируется на этой машине. Идентификатор становится именем каталога, и изменить его позже нельзя; '
    + 'всё остальное редактируется в файлах самого пресета.',
  create: 'Создать',
  creating: 'Создание…',
  creatorDraft: 'Создать свой пресет в режиме Creator',
  openLocation: 'Открыть папку',
  showLocation: 'Показать расположение',
  revealedPathLabel: 'Файлы пресета:',
  idRequired: 'Укажите идентификатор пресета.',
  idInvalid: 'Используйте строчные буквы, цифры и дефисы; первый символ — буква или цифра.',
  idTaken: 'Пресет с таким идентификатором уже существует.',
  deleteTitle: 'Удалить этот пресет?',
  deleteDescription:
    'Каталог пресета будет удалён. Запущенные с ним сессии продолжат работать; новые сессии не смогут его выбрать.',
  deleteConfirm: 'Удалить',
  deleting: 'Удаление…',
}

/** Preset roster fields needed to resolve Web display copy. */
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active Web locale. */
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  code: { name: 'presetCodeName', description: 'presetCodeDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active Web locale lookup.
 * @returns localized copy for a known shipped preset, otherwise file metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}
