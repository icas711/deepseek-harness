# @deepseek-ai/dsh-stations

Хост-сторона моста станций: плагин `stations` (default-export `StationsService`,
сервис `ctx.stations`, конфиг `{ registryPath, pairingCodeTtlMs? }`). Пользователь
сопрягает свой компьютер как «станцию»: коннектор сам дial-out по WSS к
оркестратору (работает за NAT), аутентифицируется одноразовым кодом, привязывается
к логину и корневой папке. Пассивен без пар: реестр читается при активации,
соединений и таймеров нет.

Сервис:

- `beginPairing(login)` → `{ code, wssPath }` — одноразовый код в памяти с TTL
  (`pairingCodeTtlMs`, умолчание 10 минут); рестарт хоста коды забывает.
- `completePairing(code, stationName, rootPath, platform)` → `{ stationId, token }` —
  вызывает сессия при первом соединении коннектора; код гасится одним
  использованием, токен едет коннектору ровно один раз, хост хранит только sha256.
- `list(login?)` — виды станций без секретного материала, с признаком `online`.
- `verifyStationToken(token)` — timing-safe сверка хэша; единая точка
  аутентификации и для auth-места вебсервера, и для приветствия сессии.
- `bridge(stationId)` — живой мост (запрос/события) для провайдеров швов
  `ctx.fs`/`ctx.subprocess`; `unknown-station`/`offline` различаются.
- Реестр `station-registry.json` (в композициях — `dshHomePath(...)`): записи
  `{ stationId, login, name, rootPath, platform, tokenHash, createdAt, lastSeenAt }`,
  строгий разбор на границе носителя (битый документ валит загрузку громко),
  атомарная запись с writer-lock и слиянием по `stationId` (шаблон — реестр
  задач `dsh-task-supervisor`).

Upgrade-маршрут `STATION_WS_PATH` (`/station-ws`) регистрируется на веб-сервере
при активации. Транспортная аутентификация апгрейда — владелец auth-места
(`@deepseek-ai/dsh-web-app/webauth`): путь станции он пускает по токену станции
из этого реестра, остальные пути — по-прежнему cookie/Basic. Привязка сокета к
станции авторитетна на уровне приветствия протокола: без auth-места (локальная
композиция) токен проверяет сама сессия, с auth-местом проверка двоится —
это осознанная защита в глубину, ключ один и тот же.

Сессия хоста (`StationServerSession`) ведёт приветствие, корреляцию запрос/ответ
по id и рассылку событий; закрытие сокета отклоняет все ожидающие запросы.
Свежее соединение станции заменяет прежнее: замещённая сессия гасится,
её ожидающие запросы получают отказ.

## Model Experience

None, as the package is a transport and registry service between the web user and the station connector; sessions reach it only through the capability providers composed in 5b, and nothing here enters a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Привязка провайдеров к сессии — этап 5b**: пакет предоставляет только
  зарегистрированных провайдеров-адаптеров и мост; выбор станции для сессии
  (preset/isolate-механика) и офлайн-ожидание задач не входят в 5a.
- **Один живой мост на станцию** — свежее соединение заменяет прежнее;
  параллельные коннекторы одной станции не поддерживаются.
- **UI сопряжения отсутствует** (этап 6): список и выдача кода доступны
  через RPC-домен `station.*`, страницы в веб-интерфейсе ещё нет.