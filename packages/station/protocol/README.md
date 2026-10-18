# @deepseek-ai/dsh-station-protocol

Каркас проводного протокола моста станций — общая библиотека обеих сторон. Хост и коннектор обмениваются текстовыми WSS-кадрами; пакет владеет версией протокола, закрытыми юнионами кадров/операций/событий, полным структурным декодером проводной границы и общей проверкой изоляции путей.

Состав:

- `STATION_PROTOCOL_VERSION` — версия проводного формата; несовпадение versions расходится через кадр `reject` с причиной `protocol-version`, а не падением.
- `STATION_WS_PATH` — путь upgrade-маршрута станции (`/station-ws`), фиксирован контрактом.
- `decodeStationFrame` / `decodeStationText` — полная структурная проверка кадра; нарушивший формат отправитель отключается, кадр не «чинится» на лету.
- Кадры: `hello`/`welcome`/`reject` (приветствие), `req`/`res` (запрос-ответ с корреляцией по id), `evt` (события процессов). Закрытые юнионы завершаются `assertNever` на потребителе.
- `resolveWithinRoot` / `realpathWithinRoot` — изоляция путей по правилам платформы станции: лексическое удержание внутри корня плюс канонизация realpath самого глубокого существующего предка против обхода корня символьной ссылкой. Вызывают ОБЕ стороны: хост до отправки, коннектор перед исполнением.
- `StationId` / `StationRequestId` — бренды непрозрачных идентификаторов.

Пакет не знает ни о Cordis-сервисах, ни о транспорте: соединение, повторы и исполнение операций — забота `@deepseek-ai/dsh-stations` (хост) и `@deepseek-ai/dsh-station-connector` (станция).

## Model Experience

None, as the package is a wire-codec library between the host and the station connector; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Канонизация realpath требует существования предков пути** — для ещё не созданного пути на отсутствующем томе канонизация невозможна, и `realpathWithinRoot` отказывает вместо тихого пропуска; коннектор различает этот случай как `denied`.
- **Мультиплексирование stdin/stdout-протоколов поверх канала** (PTY, resize, сигнал фореграунда) не входит в версию 1; терминальные сессии через мост — этап 5b.