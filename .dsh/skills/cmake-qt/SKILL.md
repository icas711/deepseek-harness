---
name: cmake-qt
description: "CMake и Qt6 под Windows — find_package и CMAKE_PREFIX_PATH, AUTOMOC/AUTOUIC/AUTORCC, qt_add_executable, тулчейны MSVC vs MinGW, развёртывание windeployqt"
whenToUse: "Когда агент настраивает CMake-сборку Qt6-приложения под Windows, выбирает генератор под MSVC или MinGW, включает AUTOMOC/AUTOUIC/AUTORCC или разбирает ошибки запуска собранного exe — отсутствующие DLL, platform plugin windows, qt.conf"
---

# CMake + Qt6: сборка и развёртывание под Windows

Справочник по канонической связке `find_package(Qt6)` → цели `Qt6::*` → `qt_add_executable` → `windeployqt`, плюс различия тулчейнов MSVC и MinGW. Факты сверены с CMake-скриптами реальной установки Qt 6.11 (каталог `lib/cmake/Qt6*`), встроенной документацией CMake (`cmake --help-property/command/variable`) и строками справки самого `windeployqt` 6.11.1; живой доступ к doc.qt.io из песочницы отсутствовал.

## Подключение Qt6: find_package и цели

```cmake
cmake_minimum_required(VERSION 3.21)          # Qt6 требует CMake >= 3.16 (рекомендуется 3.21+)
project(chat VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Где искать Qt: корень установки (каталог с lib/cmake/Qt6)
# Вариант A: переменная окружения CMAKE_PREFIX_PATH (учитывается автоматически)
#   MSVC:  set CMAKE_PREFIX_PATH=C:\Qt\6.8.2\msvc2022_64
#   MinGW: set CMAKE_PREFIX_PATH=C:\Qt\6.8.2\mingw_64
# Вариант B: флаг при конфигурации (рекомендуется):
#   cmake -B build -DCMAKE_PREFIX_PATH=C:\Qt\6.8.2\mingw_64
# MSYS2 pacman-установки prefix не требуют (Qt лежит в /mingw64 того же корня)

find_package(Qt6 6.5 REQUIRED COMPONENTS Widgets WebSockets Network)
```

`CMAKE_PREFIX_PATH` — разделяемый `;` список префиксов, которые `find_package/find_library/find_program/find_file/find_path` дополняют своими подкаталогами (`lib`, `bin`, `include`). Работает и одноимённая переменная окружения. В особенно упорных случаях помогает `-DQt6_DIR=C:\Qt\6.8.2\mingw_64\lib\cmake\Qt6` — прямое указание на Qt6Config.cmake.

Каждый компонент создаёт импортированную цель вида `Qt6::<Component>`; у каждой есть транзитивные зависимости (например, `Qt6::WebSockets` ссылается на `Qt6::Core;Qt6::Network` — Network можно явно не перечислять, но явность не ошибочна). Ссылаться нужно на цели, а не на голые имена библиотек: цель несёт include-пути, определения и флаги.

| Компонент | Цель | Что даёт |
|---|---|---|
| Core | `Qt6::Core` | QObject, цикл событий; `qt_add_executable` линкует её сам |
| Gui | `Qt6::Gui` | QGuiApplication, рендеринг, шрифты |
| Widgets | `Qt6::Widgets` | QWidget и все виджеты (зависит от Gui) |
| Network | `Qt6::Network` | QTcpSocket, QNetworkAccessManager |
| WebSockets | `Qt6::WebSockets` | QWebSocket, QWebSocketServer (зависит от Core, Network) |

## AUTOMOC / AUTOUIC / AUTORCC и qt_standard_project_setup

Что делает каждый (подтверждено `cmake --help-property AUTOMOC/AUTOUIC/AUTORCC`):

- **AUTOMOC** — на этапе сборки CMake сканирует заголовки и исходники цели, для классов с `Q_OBJECT`/`Q_GADGET`/`Q_NAMESPACE` запускает `moc`. Результаты собираются в единый translation unit `<AUTOGEN_BUILD_DIR>/mocs_compilation.cpp` (или `mocs_compilation_<CONFIG>.cpp` для конфиг-зависимых сборок), который добавляется к цели. Отдельные `moc_*.cpp` в список источников добавлять не нужно.
- **#include "foo.moc"** — нужен, когда `Q_OBJECT`-класс объявлен **в .cpp-файле**: moc генерирует `foo.moc`, который включается в конец этого же cpp. AUTOMOC это обрабатывает автоматически; при ручном прогоне moc подключение обязательно, иначе «undefined reference to vtable».
- **AUTOUIC** — для `#include "ui_<base>.h"` в исходниках ищет `<base>.ui` (в каталоге исходника и в `AUTOUIC_SEARCH_PATHS`) и запускает `uic`, генерируя `ui_<base>.h`.
- **AUTORCC** — `.qrc`-файлы, добавленные в список источников цели, прогоняются через `rcc` (для повторно используемых имён — генерируются уникальные `rcc_*`-файлы).

`qt_standard_project_setup()` (безверсионный алиас `qt6_standard_project_setup`, подтверждено в `Qt6CoreMacros.cmake`):

- включает `CMAKE_AUTOMOC` и `CMAKE_AUTOUIC`, **если они ещё не заданы** (цикл `foreach(auto_set IN ITEMS MOC UIC)`) — **AUTORCC она НЕ включает**;
- на Windows задаёт `CMAKE_RUNTIME_OUTPUT_DIRECTORY` = текущий binary-каталог (DLL и exe в одном месте);
- подключает GNUInstallDirs и настраивает RPATH на не-Windows платформах.

```cmake
qt_standard_project_setup()               # AUTOMOC + AUTOUIC + вывод в <build>/ (рекомендуется)

# Или вручную (полный контроль):
# set(CMAKE_AUTOMOC ON)
# set(CMAKE_AUTOUIC ON)
# set(CMAKE_AUTORCC ON)                  # только если есть .qrc
```

## Цель: qt_add_executable vs add_executable

```cmake
qt_add_executable(chat WIN32 MANUAL_FINALIZATION
    src/main.cpp
    src/wsclient.h src/wsclient.cpp
)

target_link_libraries(chat PRIVATE Qt6::Widgets Qt6::WebSockets)
```

- `qt_add_executable` — обёртка над `add_executable` (подтверждено: `_qt_internal_create_executable` вызывает `add_executable("${target}" ${ARGN})`), которая дополнительно: линкует `Qt6::Core`, планирует финализацию (плагины, метатайпы) и поддерживает платформенные цели (Android и т.п.).
- Ключевое слово `WIN32` пробрасывается в `add_executable` и ставит свойство `WIN32_EXECUTABLE` — GUI-приложение без консольного окна (`MACOSX_BUNDLE` — аналог для macOS-бандла). Без `WIN32` при запуске из Explorer откроется чёрное консольное окно.
- `MANUAL_FINALIZATION` откладывает `qt_finalize_target()` — нужен редко (когда плагины/источники добавляются после создания цели); при обычном использовании не указывайте.
- Обычный `add_executable(chat WIN32 …)` + `target_link_libraries` работает одинаково; `qt_add_executable` — рекомендуемый Qt-стиль.
- Ресурсы: `qt_add_resources(chat "res" PREFIX "/" FILES icons/send.png)` или просто добавить `.qrc` в источники при `AUTORCC ON`.
- Переводы: `qt_add_translations`, `qt_add_lupdate/qt_add_lrelease`.

## MSVC vs MinGW

Не смешивайте: Qt-библиотеки собраны конкретным компилятором, ABI несовместим (разное C++ runtime — UCRT/MSVCRT vs /MD, разный name mangling). Qt-установка для MSVC (`msvc2022_64`) не слинкуется MinGW-сборкой и наоборот; PATH и `CMAKE_PREFIX_PATH` должны указывать на «свой» комплект. Ошибка линковки вида `undefined reference to ...@Qt6...` или падение `find_package` с «not compatible» — почти всегда смешение тулчейнов.

Типовая конфигурация MSVC (Visual Studio или Ninja + cl):

```powershell
# Visual Studio 2022 (IDE-решение; cl из VS, arch x64 по умолчанию):
cmake -B build-msvc -G "Visual Studio 17 2022" -A x64 `
      -DCMAKE_PREFIX_PATH=C:\Qt\6.8.2\msvc2022_64
cmake --build build-msvc --config Release

# Ninja + cl (быстрее, один конфиг): запускать из "x64 Native Tools Command Prompt"
cmake -B build-ninja -G Ninja -DCMAKE_BUILD_TYPE=Release `
      -DCMAKE_PREFIX_PATH=C:\Qt\6.8.2\msvc2022_64
cmake --build build-ninja
```

Типовая конфигурация MinGW (Ninja или MinGW Makefiles):

```powershell
# MinGW Makefiles (mingw32-make из комплекта Qt или MSYS2):
cmake -B build-mingw -G "MinGW Makefiles" `
      -DCMAKE_BUILD_TYPE=Release `
      -DCMAKE_PREFIX_PATH=C:\Qt\6.8.2\mingw_64 `
      -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++
cmake --build build-mingw

# Ninja + MinGW (быстрее): gcc/g++/ninja должны быть в PATH
cmake -B build-mingw-ninja -G Ninja -DCMAKE_BUILD_TYPE=Release `
      -DCMAKE_PREFIX_PATH=C:\Qt\6.8.2\mingw_64
```

Приоритет: Ninja + cl (быстро, один build type) > Visual Studio (мультиконфиг, дебаг в IDE) > MinGW (если нет лицензии/MSVC или нужен GCC-стек). CMAKE_BUILD_TYPE значим только для одно-конфигурационных генераторов (Ninja, MinGW Makefiles); у Visual Studio конфигурация задаётся при сборке (`--config Release`).

## windeployqt

Собранный exe не запустится на чистой машине: нужны Qt-DLL и плагины. `windeployqt` сканирует бинарник и копирует всё необходимое рядом с ним.

```powershell
# Запуск из каталога сборки (bin каталога Qt уже в PATH):
C:\Qt\6.8.2\mingw_64\bin\windeployqt.exe build\chat.exe

# Типовые опции (сверено со справкой windeployqt 6.11.1):
#   --release           считать бинарники release (по умолчанию для release-сборок)
#   --debug             считать бинарники debug (копирует DLL с суффиксом d)
#   --qmldir <каталог>  сканировать QML-импорты (нужно для Qt Quick; для виджетов не требуется)
#   --list mapping      только перечислить, что будет скопировано (dry-лист)
#   --dry-run           полная симуляция без копирования
#   --dir <каталог>     куда копировать (по умолчанию — рядом с exe)
#   --no-translations   не копировать .qm-переводы
#   --no-plugins        не копировать плагины
#   --compiler-runtime  копировать компиляторный runtime (D3D-компилятор и т.п., Desktop)
```

Что копирует (для виджетного приложения): `Qt6Core.dll`, `Qt6Gui.dll`, `Qt6Widgets.dll`, `Qt6Network.dll`, `Qt6WebSockets.dll` и транзитивные зависимости — в каталог exe; плагины в подкаталог `platforms\qwindows.dll` (плагин платформы Windows обязателен, без него окно не создастся), при необходимости `styles\`, `imageformats\`, `tls\`; переводы `translations\qtbase_*.qm`. Для debug-сборок — DLL с суффиксами (`Qt6Cored.dll`) и `.pdb` (с `--pdb`, MSVC). Для MinGW дополнительно может понадобиться `libgcc_s_seh-1.dll`, `libstdc++-6.dll`, `libwinpthread-1.dll` (опция `--compiler-runtime`/`--no-compiler-runtime` ими управляет).

`qt.conf` — INI-файл рядом с exe, переопределяющий пути, по которым Qt ищет плагины и данные:

```ini
[Paths]
Plugins = plugins
Libraries = .
```

windeployqt создаёт его не всегда; при ручной раскладке (DLL в корне, плагины в `plugins/`) — пропишите сами.

### Типичные ошибки запуска

- **`Could not find the Qt platform plugin "windows"`** — рядом с exe нет `platforms\qwindows.dll`. Лечится запуском windeployqt (или `QT_QPA_PLATFORM_PLUGIN_PATH` для отладки на машине разработчика).
- **`The code execution cannot proceed because Qt6Core.dll was not found`** — Qt не в PATH и не скопирован; на машине разработки временно добавьте `<Qt>\bin` в PATH, для переноски — windeployqt.
- **`0xc0000135` / `0xc000007b`** — смешаны debug/release DLL или x86/x64; проверьте разрядность всех DLL рядом с exe.
- **Проверка зависимостей**: `dumpbin /dependents chat.exe` (из окружения VS) покажет импортируемые DLL; GUI-альтернатива — Dependencies (lucasg). У MinGW — `objdump -p chat.exe | findstr "DLL Name"`.

## Типичные ошибки CMake

- **`Could not find a package configuration file provided by "Qt6"`** — не задан `CMAKE_PREFIX_PATH` (или он указывает не на тот корень). Проверьте, что в `<префикс>\lib\cmake\Qt6\Qt6Config.cmake` существует.
- **AUTOMOC не видит заголовки вне списка источников** — заголовки с `Q_OBJECT` кладите в `target_sources(...)`, а не только в `#include`.
- **`undefined reference to vtable for …`** — класс с `Q_OBJECT` не обработан moc: файл не в цели, AUTOMOC выключен или нет `#include "foo.moc"` для класса в .cpp.
- **`Project does not specify CMAKE_CXX_STANDARD` при `qt_standard_project_setup`** — задайте стандарт до/независимо: переменные CXX_STANDARD она не выставляет.
- **Два генератора в одном каталоге сборки** — CMake кэширует генератор; смена MSVC↔MinGW требует новый `-B build-…` каталог.
- **MinGW-сборка не видит ninja** — `ninja` для MinGW существует в двух вариантах; убедитесь, что в PATH именно та, что совместима с вашим компилятором.

## Документация

- Qt CMake — подключение и цели: https://doc.qt.io/qt-6/cmake-get-started.html
- Qt CMake manual (полный список команд): https://doc.qt.io/qt-6/cmake-qt-command-reference.html
- qt_standard_project_setup: https://doc.qt.io/qt-6/qt-standard-project-setup.html
- qt_add_executable: https://doc.qt.io/qt-6/qt-add-executable.html
- AUTOMOC: https://doc.qt.io/qt-6/cmake-qt-command-reference.html#automoc (детали: https://cmake.org/cmake/help/latest/prop_tgt/AUTOMOC.html)
- AUTOUIC / AUTORCC: https://cmake.org/cmake/help/latest/prop_tgt/AUTOUIC.html, https://cmake.org/cmake/help/latest/prop_tgt/AUTORCC.html
- CMAKE_PREFIX_PATH: https://cmake.org/cmake/help/latest/variable/CMAKE_PREFIX_PATH.html
- add_executable (WIN32/MACOSX_BUNDLE): https://cmake.org/cmake/help/latest/command/add_executable.html
- windeployqt: https://doc.qt.io/qt-6/windows-deployment.html
- Deployment on Windows (включая qt.conf и plugin layout): https://doc.qt.io/qt-6/windows-deployment.html
- Supported platforms/compilers для Windows: https://doc.qt.io/qt-6/supported-platforms.html

Факты сверены с CMake-файлами установки Qt 6.11.1 (`Qt6Config.cmake`, `Qt6CoreMacros.cmake`, `Qt6WebSocketsTargets.cmake`), встроенной справкой CMake 4.4 (`--help-property AUTOMOC/AUTOUIC/AUTORCC`, `--help-command add_executable`, `--help-variable CMAKE_PREFIX_PATH`) и текстом справки `windeployqt 6.11.1`. Живые страницы doc.qt.io из песочницы не открывались — URL канонические.
