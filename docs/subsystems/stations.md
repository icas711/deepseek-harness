# Мост станций

Сервис `ctx.stations` ([`@deepseek-ai/dsh-stations`](../../packages/host/stations/README.md)) — хост-сторона моста станций: сопряжение машины пользователя как «станции», долговременный реестр `station-registry.json` и upgrade-маршрут `/station-ws`, по которому коннектор сам dial-out'ится к оркестратору за NAT. Пассивен без пар: до первого запроса кода сопряжения ни соединений, ни таймеров нет. Проектное решение — [Agent Note о мосте станций](../../.agents/notes/implemented/architecture/2026-11-24-station-bridge.md); эта страница фиксирует публичный контракт сервиса, а [README пакета](../../packages/host/stations/README.md) владеет композицией и транспортной аутентификацией.

## Сопряжение и реестр

`beginPairing(login)` выдаёт одноразовый код в памяти с TTL; коннектор предъявляет его в приветствии сессии, и `completePairing` гасит код одним использованием, минтуя `stationId` и токен (хост хранит только sha256). Записи реестра `{ stationId, login, name, rootPath, platform, tokenHash, createdAt, lastSeenAt }` строго разбираются на границе носителя — битый документ валит загрузку громко — и коммитятся под writer-lock со слиянием по `stationId`.

## Онлайн-статус и мир исполнения

Живое соединение коннектора публикуется как мост для провайдеров `fs-station`/`subprocess-station`; смена онлайн-статуса подъезжает типизированным событием `station/status` (`{ stationId, online }`) — на настоящей смене статуса: подключение после приветствия или закрытие живого сокета, замена одного соединения другим статус не меняет. Потребители — [супервизор задач](task-supervisor.md) (офлайн-ожидание привязанных задач и автопродолжение при возврате) и наблюдатели уведомлений. Выбор станции для сессии делает [`session.create` с `executionTarget`](../../packages/host/apiproxy/README.md) — провайдеры монтируются в скоупе агента с приватными isolate-метками; проверка принадлежности станции логину — на этой wire-границе.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxstations--stationsservice"></a>

### `ctx.stations` — `StationsService`

Сервис станций. Владеет реестром, одноразовыми кодами сопряжения (в памяти, с TTL) и живыми сессиями-мостами; upgrade-маршрут регистрирует на веб-сервере при активации. Токены хранятся только хэшированными: полный токен едет коннектору ровно один раз.

```ts cordis-catalog
/**
 * Выдаёт одноразовый код сопряжения для логина. Код живёт в памяти
 * с TTL; рестарт хоста его забывает — пользователь просто запрашивает
 * новый.
 * @param login - логин веб-пользователя, к которому привяжется станция.
 * @returns код и путь WSS-маршрута для коннектора.
 * @throws StationsError `bad-input` при пустом логине.
 */
beginPairing(login: string): { code: string; wssPath: string }

/**
 * Завершает сопряжение по одноразовому коду; вызывает сессия при
 * первом соединении коннектора. Код гасится одним использованием.
 * @param code - код из beginPairing.
 * @param stationName - имя станции от коннектора.
 * @param rootPath - корневая папка на станции.
 * @param platform - платформа станции.
 * @returns идентификатор, полный токен (только этот раз) и эхо корня.
 * @throws StationsError `bad-code` (неизвестен, протух или использован),
 * `bad-input` при недопустимом имени или корне.
 */
async completePairing( code: string, stationName: string, rootPath: string, platform: StationPlatform, ): Promise<{ stationId: StationId; token: string; rootPath: string }>

/**
 * Список станций логина, отсортированный по имени.
 * @param login - логин владельца; undefined означает все станции
 *   (админский обзор).
 * @returns виды станций без секретного материала.
 */
async list(login?: string): Promise<StationView[]>

/**
 * Вид одной станции без секретного материала: существует ли станция и кому
 * сопряжена — источник проверки принадлежности для потребителей RPC
 * (привязка сессии к станции исполнения).
 * @param stationId - идентификатор станции.
 * @returns вид станции или undefined, когда станция не сопряжена.
 */
async get(stationId: StationId): Promise<StationView | undefined>

/**
 * Проверяет токен станции timing-safe сравнением хэша; точка
 * аутентификации и для auth-места вебсервера, и для приветствия сессии.
 * @param token - предъявленный токен.
 * @returns запись станции или undefined, когда токен не принят.
 */
verifyStationToken(token: string): { stationId: StationId; rootPath: string; platform: StationPlatform } | undefined

/**
 * Живой мост к станции для провайдеров швов fs/subprocess.
 * @param stationId - идентификатор станции.
 * @returns мост, когда станция на связи.
 * @throws StationsError `unknown-station` / `offline`.
 */
bridge(stationId: StationId): StationBridge

/**
 * Онлайн-ли станция прямо сейчас.
 * @param stationId - идентификатор станции.
 * @returns true, когда живое соединение коннектора открыто.
 */
isOnline(stationId: StationId): boolean

/**
 * Запись реестра о станции без секретного материала — источник корня и
 * платформы для провайдеров швов: проверка путей на хосте обязана работать
 * и когда станция офлайн.
 * @param stationId - идентификатор станции.
 * @returns корень и платформа записи, или undefined для несопряжённой.
 */
async describe(stationId: StationId): Promise<{ rootPath: string; platform: StationPlatform } | undefined>
```

Source: [`packages/host/stations/src/index.ts:111`](../../packages/host/stations/src/index.ts)

<a id="station-events"></a>

### `station/*` events

<a id="stationstatus--emit"></a>

#### `station/status` — emit

Онлайн-статус станции сменился: соединение коннектора открылось после приветствия или закрылось. Замена одного живого соединения другим (свежее выигрывает) статус не меняет и события не поднимает. Подписчики: супервизор задач (перевод привязанных задач в офлайн-ожидание и автопродолжение при возврате) и наблюдатели уведомлений.

```ts cordis-catalog
/**
 * Онлайн-статус станции сменился: соединение коннектора открылось после
 * приветствия или закрылось. Замена одного живого соединения другим
 * (свежее выигрывает) статус не меняет и события не поднимает.
 * Подписчики: супервизор задач (перевод привязанных задач в офлайн-ожидание
 * и автопродолжение при возврате) и наблюдатели уведомлений.
 * @param payload - станция и её новое состояние: `{ stationId, online }`.
 * @mode emit
 */
'station/status'(payload: { stationId: StationId; online: boolean }): void
```

Source: [`packages/host/stations/src/index.ts:69`](../../packages/host/stations/src/index.ts)
<!-- END GENERATED cordis-surface -->
