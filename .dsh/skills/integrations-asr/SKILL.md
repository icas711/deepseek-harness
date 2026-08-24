---
name: integrations-asr
description: "Интеграции и распознавание речи: IMAP/SMTP через imaplib, smtplib и email, каркас REST/СЭД/SAP-адаптеров с pyrfc, транскрипция faster-whisper и диаризация pyannote со склейкой по таймкодам"
whenToUse: "Когда нужно принимать или отправлять почту программно (IMAP/SMTP, вложения, кодировки), строить адаптер к внешней системе (СЭД, SAP, REST), распознавать речь через faster-whisper или разделять дикторов pyannote и объединять это в итоговый транскрипт"
---

# Интеграции: почта, СЭД/SAP-адаптеры, ASR

Проверено исполнением: stdlib `imaplib`/`smtplib`/`email` (Python 3.12), `requests` 2.32.5, `httpx` 0.28.1. Разделы faster-whisper и pyannote не проверялись в этой сессии (библиотеки не установлены) — помечено в тексте.

## IMAP: приём почты (imaplib)

### Подключение, поиск, выборка

```python
import imaplib, ssl

ctx = ssl.create_default_context()
m = imaplib.IMAP4_SSL("imap.example.com", 993, ssl_context=ctx)   # порт по умолчанию 993
m.login("user@example.com", "app-password")
status, _ = m.select("INBOX")            # или m.select("INBOX", readonly=True)
assert status == "OK"

status, data = m.search(None, "UNSEEN", '(SINCE "01-Jan-2025")')
ids = data[0].split()                    # [b'41', b'42', ...]

status, msg_data = m.fetch(ids[0], "(RFC822)")
raw = msg_data[0][1]                     # bytes письма
```

- `search(charset, *criteria)` (сигнатура проверена): charset обычно `None`; критерии — без пробела внутри скобок: `(FROM "boss@x.com" SUBJECT "счёт")`, `UNSEEN`, `SINCE "dd-Mon-yyyy"`.
- `fetch(message_set, message_parts)`: `RFC822` — всё письмо; `(BODY.PEEK[HEADER])` — только заголовки без снятия флага `\Seen`.
- `select(..., readonly=True)` не снимает `\Seen` при fetch.
- Для стабильной адресации используйте UID: `m.uid("SEARCH", ...)` / `m.uid("FETCH", uid, ...)` (сигнатура `uid(command, *args)` проверена) — порядковые номера меняются при `expunge`.

### Разбор письма через email

```python
from email import message_from_bytes, policy

msg = message_from_bytes(raw, policy=policy.default)   # современный API
subject, from_, date = msg["Subject"], msg["From"], msg["Date"]

for part in msg.walk():           # рекурсивный обход дерева частей
    if part.is_multipart():
        continue
    if part.get_filename():       # вложение
        payload = part.get_payload(decode=True)        # bytes, раскодировано из base64
        with open(part.get_filename(), "wb") as f:     # имя уже декодировано (проверено)
            f.write(payload)
    elif part.get_content_type() == "text/plain":
        body = part.get_payload(decode=True).decode(
            part.get_content_charset() or "utf-8", errors="replace")
```

- Всегда парсите с `policy=policy.default`: старый `compat32` возвращает сырые encoded-words (`=?utf-8?b?...?=`) в заголовках.
- Кодировку тела брать из `get_content_charset()`, не угадывать; для legacy-заголовков — `email.header.decode_header()` (возвращает список `(bytes|str, charset)` — проверено).

### Флаги, папки, poll vs IDLE

```python
m.store(ids[0].decode(), "+FLAGS", "\\Seen")     # пометить прочитанным
m.store(ids[0].decode(), "+FLAGS", "(\\Deleted)")
m.expunge()
typ, boxes = m.list()
m.logout()
```

- Имена папок в IMAP — modified UTF-7; в `imaplib` авто-кодека нет, кириллическая папка выглядит как `"&BB4EgRPFEEQ-"`. Альтернатива — пакет `IMAPClient` с нативным UTF-7 и методом `idle()` (актуальность API не проверена в этой сессии). В stdlib `IMAP4.idle()` нет (проверено).
- Stdlib-вариант мониторинга — периодический `search(UNSEEN)` каждые 30–60 с; IDLE требует внешней библиотеки и пере-выпуска до истечения серверного тайм-аута (~29 мин). Для сервисов предпочтителен poll с идемпотентной обработкой по `Message-ID`.

## SMTP: отправка

```python
import smtplib, ssl
from email.message import EmailMessage
from email.utils import formataddr

msg = EmailMessage(policy=policy.default)
msg["From"] = formataddr(("Иван Петров", "bot@example.com"))
msg["To"] = "client@example.com"
msg["Subject"] = "Счёт №41"                 # кириллица кодируется автоматически (проверено)
msg.set_content("Тело письма")
msg.add_attachment(open("счёт.csv", "rb").read(),
                   maintype="text", subtype="csv",
                   filename="счёт-июнь.csv")  # не-ASCII имя — автоматически

ctx = ssl.create_default_context()
with smtplib.SMTP_SSL("smtp.example.com", 465, context=ctx) as s:   # implicit TLS
# with smtplib.SMTP("smtp.example.com", 587, timeout=30) as s:      # либо:
#     s.starttls(context=ctx)                                       # STARTTLS на 587
    s.login("bot@example.com", "app-password")
    s.send_message(msg)                  # адреса берёт из заголовков; корректно гасит Bcc
```

- `send_message(msg)` (сигнатура проверена) предпочтительнее `sendmail` с `msg.as_string()`.
- Legacy-путь `MIMEMultipart` + `MIMEText` + `encoders.encode_base64` работает, но для нового кода берите `EmailMessage`.
- Пароли — из хранилища секретов (см. скил `app-security-rbac`), не из кода.

## Адаптеры СЭД/SAP

Конкретные API СЭД (1С:Документооборот, Directum, ЭОС и др.) и SAP-интерфейсы проектно-специфичны: у каждого внедрения свои контракты. Скил даёт каркас; реальные имена методов/полей — из документации интеграции проекта.

### Универсальный паттерн адаптера

```python
from typing import Protocol, runtime_checkable

@runtime_checkable
class DocGateway(Protocol):
    def create_document(self, payload: dict) -> str: ...   # -> внешний ID
    def upload_file(self, doc_id: str, path: str) -> None: ...
    def get_status(self, doc_id: str) -> dict: ...

class SapRestDocGateway:                  # имплементация: REST через PI/PO
    def __init__(self, base_url: str, token: str, timeout: float = 30.0):
        self._http = httpx.Client(base_url=base_url, timeout=timeout,
                                  headers={"Authorization": f"Bearer {token}"})

    def create_document(self, payload: dict) -> str:
        r = self._http.post("/documents", json=payload)
        r.raise_for_status()
        return r.json()["id"]
```

Бизнес-логика зависит только от `DocGateway`; подменяемость имплементаций (REST, pyrfc, файловый обмен) — цель паттерна.

### REST-гигиена

- Явный `timeout` на каждый вызов: `httpx.Timeout(connect=5, read=30)`; `requests` — кортеж `(connect, read)`. Запрос без тайм-аута зависает навсегда.
- Retry с экспоненциальной задержкой — только для идемпотентных операций и сетевых/5xx ошибок (`urllib3.util.Retry`, transport-level retries у httpx); 4xx не ретраить.
- Идемпотентность: уникальный ключ операции (`Idempotency-Key` или внешний ID документа) — повтор после тайм-аута не должен создавать дубль во внешней системе.
- Один клиент (`requests.Session`/`httpx.Client`) на процесс, не клиент на вызов.

### SAP: pyrfc и IDoc

- `pyrfc` (обёртка над SAP NW RFC SDK): `Connection(**conn_params)` с прямыми параметрами (`ashost`, `sysnr`, `client`, `user`, `passwd`) или `dest=` для RFC-назначения; изменяющие данные BAPI завершают `conn.call("BAPI_TRANSACTION_COMMIT", WAIT="X")`; закрытие `conn.close()`. Точные параметры зависят от версии SDK — не проверено в этой сессии; установка требует локального SAP NW RFC SDK.
- BAPI принимают/возвращают табличные параметры (dict/списки в pyrfc).
- IDoc и REST-сценарии обычно идут через шину SAP PI/PO (CPI): маппинг на стороне шины, для кода это обычный REST/XML-адаптер — применяйте паттерн выше.

## faster-whisper

Проверено по официальному README SYSTRAN/faster-whisper и исходнику `faster_whisper/transcribe.py` (master).

```python
from faster_whisper import WhisperModel, BatchedInferencePipeline

model = WhisperModel("medium", device="cpu", compute_type="int8")   # CPU-стандарт

segments, info = model.transcribe(
    "meeting.mp3",
    language="ru",           # None -> автоопределение по info.language
    beam_size=5,             # дефолт faster-whisper (у openai/whisper — 1)
    vad_filter=True,         # отсечь тишину/шум перед распознаванием
    word_timestamps=True,    # + слова с границами внутри сегмента
)
for seg in segments:         # генератор: считается при итерации
    print(f"[{seg.start:7.2f} -> {seg.end:7.2f}] {seg.text}")
# info.duration, info.language, info.language_probability, info.duration_after_vad

# BatchedInferencePipeline.transcribe — drop-in замена WhisperModel.transcribe (README)
batched = BatchedInferencePipeline(model=model)
segments, info = batched.transcribe("meeting.mp3", language="ru", batch_size=16)
```

- Размеры моделей: `large-v3`, `distil-large-v3`, `turbo` подтверждены README; полный ряд `tiny`/`base`/`small`/`medium` — стандарт Whisper, загружается с HF Hub (Systran/faster-*).
- `compute_type`: на CPU — `int8`; `float16` осмыслен на GPU. Не-CUDA бэкенды поддерживают не все типы — при ошибке конвертации понижайте до `int8`.
- Сегмент (namedtuple в transcribe.py): `id`, `seek`, `start`, `end` (секунды, float), `text`, `avg_logprob`, `compression_ratio`, `no_speech_prob`, `temperature`, `words`. Мусор фильтруют порогами вроде `avg_logprob < -1.0` / `no_speech_prob > 0.7` (подбираются по материалу).
- Таймкод SRT: `f"{s//3600:02.0f}:{s%3600//60:02.0f}:{s%60:06.3f}".replace(".", ",")`.
- `vad_filter=True` укорачивает тишину, но может срезать первые тихие слова — проверяйте на своём материале.

## pyannote-диаризация

Проверено по карточке модели pyannote/speaker-diarization-3.1 (HF) и исходнику pyannote (pipeline.py, annotation.py).

```python
import os
from pyannote.audio import Pipeline

pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",     # требует pyannote.audio >= 3.1; есть и более новые ревизии
    use_auth_token=os.environ["HF_TOKEN"],  # актуальный параметр из карточки; token= не документирован
)
diarization = pipeline("meeting.mp3")       # путь к файлу / {"waveform":…, "sample_rate":…} / Audio-источник

turns = [(t.start, t.end, spk)
         for t, _, spk in diarization.itertracks(yield_label=True)]
# itertracks(yield_label=True) -> (Segment, track, label); параметра yield_merge
# в текущей сигнатуре Annotation.itertracks нет — только yield_label
# [ (0.00, 3.42, 'SPEAKER_00'), (3.50, 8.10, 'SPEAKER_01'), ... ]
```

- Модели на HF Hub gated: нужен токен **и** принятие условий на страницах обеих моделей — карточка 3.1 требует принять `pyannote/segmentation-3.0` и `pyannote/speaker-diarization-3.1`, затем создать токен hf.co/settings/tokens; иначе загрузка падает с 401/403.
- Вход: моно-аудио 16 кГц; выход — объект `Annotation`. По умолчанию CPU; GPU — `pipeline.to(torch.device("cuda"))`.
- `pipeline(..., num_speakers=2)` — точное число дикторов; `min_speakers`/`max_speakers` — границы (снижает «дрожание» меток).
- Метки `SPEAKER_00` — кластеры внутри одного файла, не имена людей; сопоставление с именами — отдельная задача.

### Склейка с транскрипцией faster-whisper

Спикер whisper-сегмента — тот, чья реплика покрывает максимум его длительности:

```python
def assign_speaker(seg, turns, coverage=0.4):
    """seg: объект сегмента whisper; turns: [(start, end, speaker)]."""
    best, best_ov = None, 0.0
    for t0, t1, spk in turns:
        ov = min(seg.end, t1) - max(seg.start, t0)
        if ov > best_ov:
            best, best_ov = spk, ov
    if best is None or best_ov < (seg.end - seg.start) * coverage:
        return "UNKNOWN"
    return best

merged = [{"start": s.start, "end": s.end, "text": s.text,
           "speaker": assign_speaker(s, turns)} for s in segments]
```

Границы whisper-сегментов не совпадают с репликами диаризации; для чистой диалоговой выгрузки пере-сегментируйте текст по смене спикера, а не выводите обе колонки как есть.

## Типичные ошибки

| Ошибка | Причина и исправление |
|---|---|
| `search` пуст при видимом письме | Критерии без пробелов внутри, дата `dd-Mon-yyyy`; проверить папку `select`. |
| Заголовки `=?utf-8?b?...?=` | Парсинг без `policy=policy.default` — примените его. |
| `UnicodeDecodeError` на теле | Декодировать `get_payload(decode=True)` c `get_content_charset()`, не «utf-8 всегда». |
| «Битые» вложения | Пишете `get_payload()` (str) вместо `get_payload(decode=True)` (bytes). |
| Кириллическая папка не находится | Имя в modified UTF-7; IMAPClient или ручной UTF-7 кодек. |
| Дубль документа в СЭД/SAP | Нет ключа идемпотентности — повтор после тайм-аута создаёт вторую запись. |
| pyannote 401/403 при загрузке | Не принят user agreement модели или не передан HF-токен. |
| Нет прогресса при transcribe | Возвращается генератор — оберните в `list(...)`, чтобы увидеть ошибку. |

## Документация

Разделы faster-whisper и pyannote сверены с официальными источниками (README SYSTRAN/faster-whisper, исходник transcribe.py, карточка pyannote/speaker-diarization-3.1, pyannote-core reference); imaplib/smtplib/email/IMAPClient/pyrfc остались без live-проверки:

- imaplib, smtplib, email: https://docs.python.org/3/library/imaplib.html , https://docs.python.org/3/library/smtplib.html , https://docs.python.org/3/library/email.policy.html
- IMAPClient: https://imapclient.readthedocs.io/
- faster-whisper: https://github.com/SYSTRAN/faster-whisper (README; BatchedInferencePipeline)
- pyannote-audio: https://github.com/pyannote/pyannote-audio ; модель: https://huggingface.co/pyannote/speaker-diarization-3.1 ; Annotation.itertracks: https://pyannote.github.io/pyannote-core/reference.html
- pyrfc: https://docs.python-sap.com/ ; SAP NW RFC SDK — через SAP Support Portal
- httpx: https://www.python-httpx.org/ ; requests: https://requests.readthedocs.io/
