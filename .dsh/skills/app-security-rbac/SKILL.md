---
name: app-security-rbac
description: "Безопасность приложения: RBAC-модель и проверка разрешений в FastAPI, JWT access+refresh и OAuth2 Password flow, хэширование паролей bcrypt/argon2, шифрование credentials (Fernet/AES-GCM, ротация, маскирование), аудит, rate limiting и защита от IDOR"
whenToUse: "Когда нужно спроектировать или реализовать доступ в приложении — роли и разрешения, проверка прав в FastAPI, JWT-токены и refresh-поток, безопасное хранение паролей и секретов внешних систем, audit log или защиту от IDOR"
---

# Безопасность приложения: RBAC, authN, шифрование credentials

Проверено исполнением: FastAPI 0.115.14, cryptography 46.0.4, bcrypt 4.0.1, passlib 1.7.4, argon2-cffi 25.1.0 (Python 3.12).

## RBAC: роли и разрешения

### Модель

Разрешение — атомарная строка `ресурс:действие`: `doc:read`, `doc:write`, `doc:approve`, `user:manage`. Роль — именованный набор разрешений; пользователю назначаются роли. Проверяйте разрешение, а не роль: `if 'doc:write' in user.perms`, не `if user.role == 'editor'` — переименование роли не ломает код.

- **Deny by default**: доступ запрещён, если разрешение явно не выдано; неизвестная роль даёт пустое множество.
- Иерархия ролей (admin ⊃ editor ⊃ viewer) выражается включением множеств разрешений, а не «старшинством» ролей в коде.

### Хранение маппинга

Статический конфиг (малые системы, редкие изменения):

```python
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "viewer":  frozenset({"doc:read"}),
    "editor":  frozenset({"doc:read", "doc:write"}),
    "admin":   frozenset({"doc:read", "doc:write", "doc:approve", "user:manage"}),
}

def permissions_of(roles: list[str]) -> set[str]:
    perms: set[str] = set()
    for r in roles:
        perms |= ROLE_PERMISSIONS.get(r, frozenset())   # неизвестная роль -> пусто
    return perms
```

Вариант «в БД» (динамические роли, административный UI):

```sql
CREATE TABLE users       (id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, pwd_hash TEXT NOT NULL);
CREATE TABLE roles       (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE permissions (id BIGSERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL);  -- 'doc:write'
CREATE TABLE user_roles       (user_id BIGINT REFERENCES users,  role_id BIGINT REFERENCES roles,      PRIMARY KEY (user_id, role_id));
CREATE TABLE role_permissions (role_id BIGINT REFERENCES roles,  perm_id BIGINT REFERENCES permissions, PRIMARY KEY (role_id, perm_id));
```

Кэшируйте вычисленное множество разрешений на время запроса/жизни access-токена; инвалидация — при смене ролей.

### Проверка разрешения как зависимость FastAPI

```python
from fastapi import Depends, HTTPException, status

async def get_current_user(token: str = Depends(oauth2_scheme)) -> User: ...

def require_permission(perm: str):
    async def checker(user: User = Depends(get_current_user)) -> User:
        if perm not in user.permissions:            # deny by default
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
        return user
    return checker

@app.post("/documents/{doc_id}")
async def write_doc(doc_id: int, payload: DocIn,
                    user: User = Depends(require_permission("doc:write"))):
    ...
```

401 — не аутентифицирован (нет/битый токен); 403 — аутентифицирован, но нет разрешения; 404 вместо 403 — когда факт существования объекта скрыт от пользователя.

## Аутентификация

### JWT: access + refresh

- Access-токен: TTL 5–15 мин, передаётся в `Authorization: Bearer <token>`. Refresh-токен: TTL дни–недели, хранится и передаётся отдельно (httpOnly cookie или выделенный endpoint), отзывается сервером (denylist/версия в БД); ротация refresh при каждом использовании ограничивает утечку.
- Payload: `sub` (user id), `iat`, `exp`, `iss`/`aud`; для авторизации — `perms` или `roles`. Кладите `perms`, если множество компактно: проверка права не требует похода в БД. Компромисс: смена ролей действует только после истечения access-TTL — держите его коротким.
- Алгоритм фиксируется whitelist'ом при декодировании (`algorithms=["HS256"]`); доверять `alg` из заголовка токена нельзя (algorithm confusion).
- Секрет — из ENV/KMS, не из кода; HS256-ключ ≥ 32 случайных байт; в распределённых системах предпочтителен RS256/ES256 (публичный ключ раздаётся для проверки).
```python
import os, jwt  # PyJWT
from datetime import datetime, timedelta, timezone

SECRET = os.environ["JWT_SECRET"]

def make_access(user_id: int, perms: list[str]) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user_id), "perms": perms, "iat": now,
                       "exp": now + timedelta(minutes=10)}, SECRET, algorithm="HS256")

def decode_access(token: str) -> dict:
    return jwt.decode(token, SECRET, algorithms=["HS256"])  # jwt.ExpiredSignatureError и др.
```

### OAuth2 Password flow в FastAPI

```python
from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

app = FastAPI()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")   # вход в /docs

async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    try:
        payload = decode_access(token)                 # decode + whitelist alg
    except jwt.PyJWTError:
        raise HTTPException(401, "Недействительный токен",
                            headers={"WWW-Authenticate": "Bearer"})
    user = await load_user(payload["sub"])             # пользователь мог быть отключён
    if user is None or user.disabled:
        raise HTTPException(401, "Пользователь недоступен")
    return user

@app.post("/auth/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    user = await authenticate(form.username, form.password)  # bcrypt-проверка
    if not user:
        raise HTTPException(401, "Неверные учётные данные")
    return {"access_token": make_access(user.id, sorted(user.permissions)),
            "token_type": "bearer"}
```

Refresh-эндпоинт принимает refresh-токен, проверяет отзыв и выдаёт новую пару.

### Хэширование паролей

- bcrypt — рабочий стандарт: salt встроен в хэш, cost factor (`rounds`) задаёт скорость.
- argon2id — современная рекомендация (устойчив к GPU-атакам; память ≥ 19 МиБ, итерации ≥ 2).
- passlib 1.7.4 работает (проверено: `passlib.hash.bcrypt.hash/verify`), но проект давно без релизов и печатает предупреждение с bcrypt ≥ 4.1; для нового кода разумны `bcrypt` или `argon2-cffi` напрямую.

```python
import bcrypt

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()

def verify_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())   # постоянное время внутри
```

- Сравнение — только библиотечной функцией (`checkpw`/`verify`), никогда `==`.
- bcrypt обрезает пароль до 72 байт молча — ограничьте длину на входе.
- Никаких «своих» MD5/SHA+salt: быстрые хэши брутфорсятся на GPU на порядки быстрее.

## Шифрование credentials внешних систем

Почтовые аккаунты роботов, API-ключи клиентов, токены СЭД — шифровать at rest; расшифровывать только в момент использования.

### Fernet (AES + HMAC) — простой выбор

```python
import os
from cryptography.fernet import Fernet, MultiFernet, InvalidToken

key = os.environ["CRED_FERNET_KEY"].encode()   # 32 байта base64; из ENV/KMS, не из git
f = Fernet(key)
ct = f.encrypt(b"client-smtp-password")
pt = f.decrypt(ct)                              # InvalidToken при ошибке/подмене
```

### AES-GCM — когда нужен associated data

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

key = AESGCM.generate_key(bit_length=256)
aes = AESGCM(key)
nonce = os.urandom(12)                          # уникальный на каждый encrypt
ct = aes.encrypt(nonce, b"payload", b"cred:client42")   # aad привязывает к владельцу
pt = aes.decrypt(nonce, ct, b"cred:client42")   # nonce хранить рядом с ct; InvalidTag при подмене
```

### Ключ, ротация, окружение

- Ключ из ENV/KMS/секрет-хранилища (Vault, AWS KMS); `.env` — только локально и вне git (`.gitignore`).
- Ротация: `MultiFernet([new, old])` — новые записи первым ключом, старые читаются любым; после перекриптации старый изымается.
- Windows-опция для машинных секретов: DPAPI (`win32crypt.CryptProtectData`) — привязка к учётной записи машины/пользователя, не переносимо между хостами.
- Никогда не логировать расшифрованные значения; в логи и UI — только маска (`sm***@corp.ru`, `sk-***42`); при отладке — id объекта, не секрет.
- Plaintext в БД и в логах недопустим; резервные копии БД наследуют шифрование — защищайте и их.

## Аудит, лимиты, object-level права

### Audit log

```python
async def audit(actor_id: int, action: str, resource: str, resource_id: str,
                allowed: bool, ip: str, meta: dict | None = None) -> None:
    await db.execute(
        "INSERT INTO audit_log(ts, actor_id, action, resource, resource_id, allowed, ip, meta) "
        "VALUES (now(), $1, $2, $3, $4, $5, $6, $7)",
        actor_id, action, resource, resource_id, allowed, ip, json.dumps(meta or {}))
```

- Фиксируйте и **отказы** (`allowed=False`) — сигнал перебора прав; отдельно `login_success` / `login_failure`.
- Только append (`INSERT`), без UPDATE/DELETE из приложения; время — серверное; в `meta` — минимум (id объекта, число строк), никаких паролей и расшифрованных секретов.

### Rate limiting (кратко)

- Алгоритм: fixed/sliding window по ключу `ip` или `user_id`; распределённым инстансам нужен общий стор (Redis `INCR`+`EXPIRE`), in-memory сбрасывается рестартом.
- Точки применения: login/refresh, `send_otp`, дорогие операции; ответ 429 с `Retry-After`, счётчик неудачных логинов с прогрессивной задержкой/блокировкой.

### Принцип минимальных привилегий

- Роль по умолчанию — минимальные разрешения; расширение по запросу с обоснованием.
- Служебные интеграции (почтовый робот, SAP-пользователь) — отдельные учётки только с нужными правами, не личные аккаунты людей.
- Периодическая ревизия: у кого `user:manage`, кому больше не положено.

### Object-level permissions и IDOR

Разрешение `doc:write` — «можно писать документы вообще»; доступ к конкретному документу — отдельная проверка владения/связи:

```python
@app.get("/documents/{doc_id}")
async def read_doc(doc_id: int, user: User = Depends(require_permission("doc:read"))):
    doc = await db.get_document(doc_id)
    if doc is None:
        raise HTTPException(404)                   # не раскрываем существование
    if not doc.visible_to(user):                   # object-level: отдел, владелец, связь
        raise HTTPException(404)
    await audit(user.id, "doc:read", "document", str(doc_id), True, request.client.host)
    return doc
```

**IDOR** (Insecure Direct Object Reference) — подмена `id` в URL/теле на чужой объект: `/documents/1042` вместо своего `/documents/17`. Защита — object-level проверка на каждый доступ, включая изменение связей (`PUT /documents/17` с `{"owner_id": 1}` — тоже смена объекта). Секретные uuid-ссылки — дополнение, не замена: uuid утекает в рефереры и логи.

## Типичные ошибки

| Ошибка | Причина и исправление |
|---|---|
| Проверка роли вместо разрешения | `user.role == 'editor'` ломается при переименовании; проверяйте `doc:write in perms`. |
| Разрешения в JWT «вечны» | `perms` в access-токене живут до exp; короткий access-TTL + refresh. |
| `alg` не в whitelist | `jwt.decode(..., algorithms=[...])` обязателен — иначе algorithm confusion. |
| `==` для паролей/хэшей | Только `bcrypt.checkpw` / `verify` — постоянное время. |
| Пароль > 72 байт в bcrypt | Молча обрезается; ограничьте длину на входе. |
| Fernet-ключ в коде или git | Ключ только ENV/KMS; `.env` вне репозитория. |
| Секреты в логах | Логируйте маски и id; фильтр на известные префиксы (`sk-`, `Bearer `). |
| 403 на чужой объект | Факт существования скрыт — 404 после object-level проверки. |
| Refresh без отзыва | Refresh надо уметь гасить (denylist/версия), иначе logout фиктивен. |
| Audit только успехов | Отказы и `login_failure` — главный сигнал атак; пишите и их. |

## Документация

Сеть в этой сессии недоступна — доступность ссылок не проверена:

- FastAPI Security: https://fastapi.tiangolo.com/tutorial/security/
- OAuth2 (RFC 6749): https://datatracker.ietf.org/doc/html/rfc6749 ; JWT (RFC 7519): https://datatracker.ietf.org/doc/html/rfc7519
- bcrypt: https://github.com/pyca/bcrypt ; argon2: https://github.com/hynek/argon2-cffi ; passlib: https://passlib.readthedocs.io/
- cryptography (Fernet, AESGCM): https://cryptography.io/en/latest/ ; PyJWT: https://pyjwt.readthedocs.io/
- OWASP Cheat Sheets (Authorization, Password Storage, IDOR): https://cheatsheetseries.owasp.org/
