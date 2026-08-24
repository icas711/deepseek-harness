---
name: qt6-widgets-cpp
description: "Qt6 Widgets на C++17 — клиент и сервер QWebSocket для стриминга токенов в GUI, сигналы-слоты между потоками, компоновка чата, markdown в QTextBrowser, владение QObject"
whenToUse: "Когда агент пишет или отлаживает Qt6-приложение на C++17 — WebSocket-стриминг ответов LLM в окно, соединения сигналов между worker-потоком и главным потоком, компоновка виджетов чата, рендер markdown в QTextBrowser или ошибки дерева владения QObject"
---

# Qt6 Widgets / C++17: WebSocket-стриминг в GUI

Справочник по связке «QWebSocket → сигнал → GUI»: обёртка-клиент, сервер, межпоточные соединения, компоновка чата, markdown-рендер и правила владения. Проверено по заголовкам Qt 6.11 (doc.qt.io в момент написания был недоступен из песочницы — сигнатуры сверены с официальными заголовками `<QtDir>/include/qt6/…`).

## QWebSocket-клиент

| Член | Сигнатура | Назначение |
|---|---|---|
| `open` | `void open(const QUrl &url)` | Подключение (есть перегрузки с `QNetworkRequest`, с `QWebSocketHandshakeOptions`) |
| `close` | `void close(QWebSocketProtocol::CloseCode closeCode = CloseCodeNormal, const QString &reason = QString())` | Закрытие с кодом |
| `sendTextMessage` | `qint64 sendTextMessage(const QString &message)` | Отправка текстового фрейма |
| `sendBinaryMessage` | `qint64 sendBinaryMessage(const QByteArray &data)` | Отправка бинарного фрейма |
| `ping` | `void ping(const QByteArray &payload = QByteArray())` | Проверка связи; ответ — сигнал `pong` |
| `state` | `QAbstractSocket::SocketState state() const` | `UnconnectedState`, `ConnectingState`, `ConnectedState`, `ClosingState` |
| `errorString` | `QString errorString() const` | Текст последней ошибки |

Сигналы: `connected()`, `disconnected()`, `stateChanged(QAbstractSocket::SocketState)`, `textMessageReceived(const QString&)`, `binaryMessageReceived(const QByteArray&)`, `textFrameReceived(const QString&, bool isLastFrame)`, `errorOccurred(QAbstractSocket::SocketError)`, `pong(quint64 elapsedTime, const QByteArray&)`, `aboutToClose()`, `readChannelFinished()`.

Коды закрытия (`QWebSocketProtocol::CloseCode`): `CloseCodeNormal = 1000`, `CloseCodeGoingAway = 1001`, `CloseCodeProtocolError = 1002`, `CloseCodeTooMuchData = 1009` и др.

### Каноническая обёртка-клиент (стриминг токенов от сервера в GUI)

Обёртка живёт в GUI-потоке, переизлучает полезный сигнал; GUI-виджеты подписываются только на него.

```cpp
// wsclient.h
#pragma once
#include <QObject>
#include <QUrl>
#include <QtWebSockets/QWebSocket>

class WsClient : public QObject {
    Q_OBJECT
public:
    explicit WsClient(const QUrl &url, QObject *parent = nullptr);
    void send(const QString &text);
    void close();
signals:
    void chunkReceived(const QString &delta);   // порция ответа сервера
    void errorText(const QString &message);
    void onlineChanged(bool online);
private:
    QUrl m_url;
    QWebSocket m_socket;    // член класса: родитель не нужен, владеет WsClient
};
```

```cpp
// wsclient.cpp
#include "wsclient.h"

WsClient::WsClient(const QUrl &url, QObject *parent) : QObject(parent), m_url(url) {
    connect(&m_socket, &QWebSocket::connected,    this, [this] { emit onlineChanged(true); });
    connect(&m_socket, &QWebSocket::disconnected, this, [this] { emit onlineChanged(false); });
    connect(&m_socket, &QWebSocket::textMessageReceived, this,
            [this](const QString &msg) { emit chunkReceived(msg); });
    connect(&m_socket, &QWebSocket::errorOccurred, this,
            [this](QAbstractSocket::SocketError) { emit errorText(m_socket.errorString()); });
    m_socket.open(m_url);
}

void WsClient::send(const QString &text) { m_socket.sendTextMessage(text); }
void WsClient::close() { m_socket.close(); }   // CloseCodeNormal, пустая причина
```

## QWebSocketServer

`explicit QWebSocketServer(const QString &serverName, SslMode secureMode, QObject *parent = nullptr)`; `SslMode`: `SecureMode = 0`, `NonSecureMode = 1` (ws:// — NonSecureMode). Методы: `bool listen(const QHostAddress &address = QHostAddress::Any, quint16 port = 0)`, `void close()`, `bool isListening()`, `quint16 serverPort()`, `bool hasPendingConnections()`, `QWebSocket *nextPendingConnection()`, `QString errorString()`. Сигналы: `newConnection()`, `closed()`, `acceptError(QAbstractSocket::SocketError)`, `serverError(QWebSocketProtocol::CloseCode)`.

```cpp
auto *server = new QWebSocketServer(QStringLiteral("chat"), QWebSocketServer::NonSecureMode, this);
if (!server->listen(QHostAddress::Any, 0))      // port 0 — выбрать свободный порт
    qWarning() << server->errorString();
const quint16 port = server->serverPort();
connect(server, &QWebSocketServer::newConnection, this, [server] {
    QWebSocket *client = server->nextPendingConnection();   // владение передано вам
    connect(client, &QWebSocket::textMessageReceived, client, [client](const QString &msg) {
        client->sendTextMessage(msg.toUpper());
    });
    connect(client, &QWebSocket::disconnected, client, &QObject::deleteLater);
});
```

## Сигналы-слоты: синтаксис и потоки

Новый синтаксис (указатели на члены) проверяет типы на этапе компиляции; строковый `SIGNAL()/SLOT()` — не использовать.

```cpp
connect(sender, &Sender::chunkReady, receiver, &Receiver::onChunk);          // метод
connect(sender, &Sender::chunkReady, this, [this](const QString &s) {        // лямбда с контекстом
    m_buffer += s;                                                           // выполнится в потоке this
});
connect(button, &QPushButton::clicked, this, [this] { submit(); });          // clicked(bool checked = false)
connect(input, &QLineEdit::returnPressed, this, [this] { submit(); });
```

Правила потоков:

- Виджеты и весь GUI — только из главного потока. Worker-поток никогда не трогает QWidget напрямую: он испускает сигнал или вызывает `QMetaObject::invokeMethod`.
- `Qt::ConnectionType`: `AutoConnection` (по умолчанию: queued при разных потоках, иначе direct), `DirectConnection`, `QueuedConnection`, `BlockingQueuedConnection` (дедлок, если потоки совпадают).
- При `QueuedConnection` аргументы копируются через очередь; кастомные типы требуют `qRegisterMetaType<T>()`. `QString`/`QByteArray` регистрировать не нужно.
- Лямбда без контекста-приёмника живёт, пока жив sender — соединение не разорвётся при удалении логического получателя; всегда передавайте контекст третьим аргументом.
- `QMetaObject::invokeMethod`: `QMetaObject::invokeMethod(obj, "slotName", Qt::QueuedConnection)` — строковая форма (слот или `Q_INVOKABLE`); `QMetaObject::invokeMethod(this, [this]{ render(); }, Qt::QueuedConnection)` — форма с контекстом-объектом, лямбда выполнится в потоке `this`.

```cpp
// worker-поток -> GUI: авто-queued, т.к. receiver в главном потоке
connect(worker, &WsWorker::chunkReady, m_view, &ChatView::appendChunk);
```

## Компоновка виджетов

| Класс | Ключевые методы | Применение |
|---|---|---|
| `QVBoxLayout` / `QHBoxLayout` | `addWidget(QWidget*, int stretch = 0, Qt::Alignment = {})`, `addLayout(QLayout*, int stretch = 0)`, `addStretch(int = 0)`, `setStretch(int index, int)`, `setStretchFactor(QWidget*/QLayout*, int)` | Вертикальный/горизонтальный стек, строятся вложением |
| `QGridLayout` | `addWidget(w, row, col[, rowSpan, colSpan, align])`, `addLayout(l, row, col)`, `setRowStretch`, `setColumnStretch` | Табличная сетка |
| `QFormLayout` | `addRow(const QString &labelText, QWidget*/QLayout*)`, `setFieldGrowthPolicy` | Формы «метка — поле» |
| `QSplitter` | `addWidget(QWidget*)`, `setSizes(const QList<int>&)`, `setStretchFactor(int index, int)` | Регулируемые разделители |
| `QScrollArea` | `setWidget(QWidget*)`, `setWidgetResizable(bool)` (включить для растяжения содержимого), `takeWidget()` | Скролл-обёртка вокруг большого содержимого |

Size policy: `QWidget::setSizePolicy(QSizePolicy::Policy horizontal, QSizePolicy::Policy vertical)`; значения — `Fixed`, `Minimum`, `Maximum`, `Preferred`, `MinimumExpanding`, `Expanding`, `Ignored`. `Expanding` — виджет хочет расти, `Fixed` — не менять размер.

### Паттерн «чат»: поток сообщений + строка ввода

```cpp
auto *view  = new QTextBrowser;                // без parent: владельца назначит layout
auto *input = new QLineEdit;
auto *send  = new QPushButton(tr("Отправить"));

auto *row = new QHBoxLayout;
row->addWidget(input, 1);                      // поле ввода растягивается
row->addWidget(send);                          // кнопка фикс. ширины

auto *root = new QVBoxLayout(window());        // window становится владельцем
root->addWidget(view, 1);                      // история забирает всё место
root->addLayout(row, 0);
```

Для лога-списка вместо `QTextBrowser` — `QListView` (`virtual void setModel(QAbstractItemModel*)` из `QAbstractItemView`) с `QStringListModel` (`stringList()` / `setStringList()`).

## QTextBrowser + markdown

`QTextBrowser : public QTextEdit` (rich text, только чтение). Markdown: `QTextDocument::setMarkdown(const QString &markdown, QTextDocument::MarkdownFeatures features = QTextDocument::MarkdownDialectGitHub)` — диалект по умолчанию GitHub: CommonMark + расширения GFM (таблицы, зачёркивание, чек-листы). Уровни: `MarkdownDialectCommonMark = 0`, `MarkdownDialectGitHub` — комбинация флагов, `MarkdownNoHTML` — запрет inline/block HTML. У `QTextEdit`/`QTextBrowser` есть `setMarkdown(const QString&)` без параметров (диалект GitHub).

- `append(const QString &text)` добавляет абзац, интерпретируя текст как rich text (auto-detect HTML) — **не** рендерит markdown-куски. Для ответа LLM: накапливайте буфер и перерисовывайте целиком `view->setMarkdown(buffer)` на каждом чанке.
- `document()->isEmpty()` — проверка пустоты; `toMarkdown()` — обратное преобразование (диалект GitHub по умолчанию).
- Ссылки: `setOpenExternalLinks(false)` + сигнал `anchorClicked(const QUrl &link)`:

```cpp
view->setOpenExternalLinks(false);
connect(view, &QTextBrowser::anchorClicked, this, [](const QUrl &url) {
    QDesktopServices::openUrl(url);            // QtGui; static bool openUrl(const QUrl&)
});
```

- Автоскролл вниз после добавления:

```cpp
view->setMarkdown(m_buffer);
QScrollBar *bar = view->verticalScrollBar();   // QAbstractScrollArea::verticalScrollBar()
bar->setValue(bar->maximum());
```

- Курсор в конец: `view->moveCursor(QTextCursor::End);` или через `setTextCursor(view->textCursor())`.
- Разметка ответа LLM: `**жирный**`, инлайновый `` `код` ``, fenced-блоки ``` ``` ```, списки и GFM-таблицы рендерятся нативно; раскраску блоков кода добавляют `setDefaultStyleSheet()`/`QSyntaxHighlighter` — это уже ручная работа.

## Владение и родители QObject

- `explicit QObject(QObject *parent = nullptr)`: родитель владеет детьми и удаляет их в своём деструкторе. Один родитель: `setParent(QObject*)` переключает владение, «двух родителей» не существует.
- `deleteLater()` — отложенное удаление через цикл событий потока объекта; безопасно из слотов, вызванных этим же объектом.
- `QWidget` в layout: `addWidget`/`addLayout` передают виджет во владение виджету, на котором установлен layout; `QWidget::setLayout(QLayout*)` забирает и layout, и его содержимое. Виджеты, добавленные в layout созданного окна, получают parent автоматически.
- `explicit QWidget(QWidget *parent = nullptr, Qt::WindowFlags f = Qt::WindowFlags())` — третий аргумент задаёт флаги окна (диалог, splash, frameless и т.п.).
- Не создавайте QWidget с parent на стеке (`QWidget w(parent)` — двойное удаление) и не оборачивайте parent-объекты в `std::unique_ptr`/`std::shared_ptr`: деструктор смарт-указателя и дерева владения удалят объект дважды. Смарт-указатели — только для QObject без parent.
- Порядок: сначала создайте виджеты без parent, отдайте их layout, а layout — окну (`new QVBoxLayout(window)`); всё очистится деревом.

## Типичные ошибки

- **GUI из worker-потока** — «QObject::startTimer: Timers cannot be started from another thread», краш. Только сигналы/`invokeMethod` в главный поток.
- **Лямбда без приёмника**: `connect(ws, &QWebSocket::textMessageReceived, [](…){…})` — соединение живёт дольше, чем логический получатель. Передавайте контекст.
- **`append()` для markdown-чанков** — автодетект HTML ломает разметку и добавляет лишние абзацы; только буфер + `setMarkdown`.
- **Нет автоскролла**: после `setMarkdown` скролл остаётся на месте — нужен `setValue(maximum())`.
- **Стековый виджет с parent** или **`std::unique_ptr<QWidget>` с parent** — двойной delete.
- **`BlockingQueuedConnection` между одинаковыми потоками** — дедлок.
- **Сигнал `error` вместо `errorOccurred`**: у QWebSocket есть оба, `error(QAbstractSocket::SocketError)` — устаревший (Qt5-совместимость), используйте `errorOccurred`.
- **Смешивание потоков у самого QWebSocket**: у объекта аффинити потока создания; вызывать `open`/`sendTextMessage` лучше из потока, где создан сокет.

## Документация

- QWebSocket: https://doc.qt.io/qt-6/qwebsocket.html
- QWebSocketServer: https://doc.qt.io/qt-6/qwebsocketserver.html
- QTextBrowser: https://doc.qt.io/qt-6/qtextbrowser.html
- QTextDocument::setMarkdown и MarkdownFeature: https://doc.qt.io/qt-6/qtextdocument.html
- QTextEdit: https://doc.qt.io/qt-6/qtextedit.html
- Сигналы и слоты: https://doc.qt.io/qt-6/signalsandslots.html
- QObject и владение: https://doc.qt.io/qt-6/qobject.html, https://doc.qt.io/qt-6/object.html
- Layouts: https://doc.qt.io/qt-6/layout.html, https://doc.qt.io/qt-6/qboxlayout.html, https://doc.qt.io/qt-6/qgridlayout.html, https://doc.qt.io/qt-6/qformlayout.html
- QScrollArea: https://doc.qt.io/qt-6/qscrollarea.html; QSplitter: https://doc.qt.io/qt-6/qsplitter.html
- Потоки в Qt: https://doc.qt.io/qt-6/thread-basics.html

Сигнатуры сверены с заголовками Qt 6.11.1 (`qwebsocket.h`, `qwebsocketserver.h`, `qtextbrowser.h`, `qtextdocument.h`, `qobjectdefs.h`, `qwidget.h`, `qboxlayout.h` и др.); URL раздела — канонические адреса doc.qt.io, их живое содержимое из песочницы не открывалось.
