---
name: office-generation
description: "Генерация Office-документов кодом Python — python-docx (DOCX), python-pptx (PPTX), openpyxl (XLSX): стили, таблицы, картинки, оглавление, write-only режим, паттерны генерации из Markdown и LLM-структур"
whenToUse: "Когда нужно создать или программно изменить DOCX-документ, PPTX-презентацию или XLSX-таблицу — отчёты, счета, выгрузки, конвертация Markdown или структурированного ответа LLM в Office-файл"
---

# Генерация Office-документов (python-docx, python-pptx, openpyxl)

Проверено исполнением: python-docx 1.2.0, openpyxl 3.1.5. Раздел python-pptx не проверялся в этой сессии (библиотека не установлена) — сверьте сигнатуры с документацией.

## python-docx (DOCX)

### Документ, заголовки, стили абзацев

```python
from docx import Document
from docx.shared import Pt, Cm, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
doc.add_heading("Годовой отчёт", 0)          # 0 -> стиль Title, 1..9 -> Heading N
doc.add_paragraph("Вводный абзац")
doc.add_paragraph("пункт списка", style="List Bullet")   # также List Number, Intense Quote
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(6)       # также line_spacing, first_line_indent
p.paragraph_format.line_spacing = 1.5
doc.save("out.docx")
```

- Уровень заголовка — только 0–9; имена доступных стилей: `[s.name for s in doc.styles]`. Стиль абзаца один; произвольное оформление внутри — на уровне run (ниже).

### Runs: форматирование внутри абзаца

```python
run = p.add_run("важно")
run.bold = True; run.italic = True; run.underline = True
run.font.size = Pt(12)
run.font.name = "Calibri"
run.font.color.rgb = RGBColor(0xFF, 0x00, 0x00)
```

Типичная ошибка: `p.text = "..."` после добавления run'ов перезапишет их все — собирайте текст заранее или добавляйте run'ы последовательно.

### Таблицы и картинки

```python
t = doc.add_table(rows=2, cols=3)
t.style = "Table Grid"                 # строкой или doc.styles[...]; по умолчанию Normal Table
t.cell(0, 0).text = "Заголовок"
merged = t.cell(0, 0).merge(t.cell(0, 1))   # объединяет прямоугольник ячеек
for row in t.rows:
    for cell in row.cells: ...              # cell.paragraphs[0].add_run(...) для стилей
t.columns[1].width = Cm(5)

doc.add_picture("chart.png", width=Inches(5.5))     # или io.BytesIO(png_bytes)
```

- Стиль по умолчанию `Normal Table` — таблица без границ; почти всегда нужен `Table Grid`.
- В `add_picture` задавайте хотя бы один габарит (`width`/`height`), иначе берётся натуральный размер.

### Секции, поля страницы, колонтитулы

```python
from docx.enum.section import WD_ORIENT

sec = doc.sections[0]
sec.top_margin, sec.bottom_margin = Cm(2), Cm(2)
sec.left_margin, sec.right_margin = Cm(2.5), Cm(1.5)
sec.orientation = WD_ORIENT.LANDSCAPE        # габариты свапнуть вручную:
sec.page_width, sec.page_height = sec.page_height, sec.page_width

sec.header.is_linked_to_previous = False     # отцепить от предыдущей секции
sec.header.paragraphs[0].text = "Конфиденциально"
sec.footer.paragraphs[0].text = "стр."   # ещё секция: doc.add_section(WD_SECTION_START.NEW_PAGE)
```

### Авто-оглавление — только field-код

python-docx не создаёт оглавление и не обновляет поля. Паттерн — вставка поля TOC вручную; Word соберёт его при открытии/по F9:

```python
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

def add_toc(doc):
    p = doc.add_paragraph()
    run = p.add_run()
    begin = OxmlElement("w:fldChar"); begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve")
    instr.text = r'TOC \o "1-3" \h \z \u'
    sep = OxmlElement("w:fldChar"); sep.set(qn("w:fldCharType"), "separate")
    txt = OxmlElement("w:t"); txt.text = "Обновите поле (F9) для сборки оглавления"
    end = OxmlElement("w:fldChar"); end.set(qn("w:fldCharType"), "end")
    for el in (begin, instr, sep, txt, end):
        run._r.append(el)
```

Заголовки должны использовать стили `Heading N` — иначе полю нечего собирать.

## python-pptx (PPTX)

Проверено по официальной документации python-pptx.readthedocs.io (stable, v0.6.22) и шаблону `default.pptx` из репозитория.

### Презентация, лейауты, 16:9

```python
from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation()                     # встроенный шаблон: 4:3, 10 x 7.5 дюйма (sldSz type="screen4x3")
prs.slide_width = Inches(13.333)         # 16:9 (13.333/7.5 = 16/9); slide_width/height хранятся в EMU
prs.slide_height = Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])   # 6 = Blank
prs.save("out.pptx")
```

Типовые индексы `slide_layouts` шаблона по умолчанию (подтверждено quickstart-докой): 0 Title Slide, 1 Title and Content (bullet), 5 Title Only, 6 Blank. Для чужого шаблона индексы зависят от него — перебирайте `prs.slide_layouts` и их placeholders.

### Placeholders и text_frame

```python
from pptx.enum.text import MSO_AUTO_SIZE

slide = prs.slides.add_slide(prs.slide_layouts[1])
for ph in slide.placeholders:
    print(ph.placeholder_format.idx, ph.placeholder_format.type, ph.name)
slide.shapes.title.text_frame.text = "Заголовок"     # title placeholder — idx 0

tf = shape.text_frame                  # placeholder / фигура
tf.word_wrap = True
tf.auto_size = MSO_AUTO_SIZE.NONE
p = tf.paragraphs[0]                   # первый абзац уже существует
run = p.add_run(); run.text = "Текст"; run.font.size = Pt(18); run.font.bold = True
p2 = tf.add_paragraph(); p2.text = "Вторая строка"
```

Placeholder идентифицируется `placeholder_format.idx` (title — всегда idx 0, если есть; остальные идут по порядку; пользовательские в PowerPoint получают idx от 10; значения не обязаны быть непрерывными). `slide.placeholders[idx]` — lookup по idx (не по позиции), неверный idx — `KeyError`. Для записи берите по idx.

### Фигуры, таблицы, картинки, заметки

```python
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor

box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                             Inches(1), Inches(1), Inches(4), Inches(2))
box.text_frame.text = "Блок"
box.fill.solid(); box.fill.fore_color.rgb = RGBColor(0xEE, 0xEE, 0xEE)

tbl = slide.shapes.add_table(rows=3, cols=2, left=Inches(1), top=Inches(3),
                             width=Inches(8), height=Inches(3)).table
tbl.cell(0, 0).text = "Ячейка"

slide.shapes.add_picture("logo.png", left=Inches(11), top=Inches(0.3), width=Inches(1.5))
slide.notes_slide.notes_text_frame.text = "Докладчику: сказать про график"
```

## openpyxl (XLSX)

### Workbook, листы, ячейки

```python
from openpyxl import Workbook, load_workbook

wb = Workbook()                        # один лист уже создан
ws = wb.active; ws.title = "Отчёт"     # первый лист
wb.create_sheet("Данные", 0)           # ещё лист; позиция необязательна
ws["A1"] = "текст"                     # ключ-адрес
c = ws.cell(row=2, column=3, value=42) # координатный доступ
for row in rows:
    ws.append(row)                     # построчная дозапись — самый быстрый обычный способ
```

### Стили и форматы

```python
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment

ws["A1"].font = Font(bold=True, size=12, color="FF0000", name="Arial")
ws["A1"].fill = PatternFill(start_color="FFEEEEEE", end_color="FFEEEEEE",
                            fill_type="solid")
thin = Side(style="thin")
ws["A1"].border = Border(left=thin, right=thin, top=thin, bottom=thin)
ws["A1"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
ws["B2"].number_format = "#,##0.00"    # также "0.0%", "DD.MM.YYYY", "@"
```

`PatternFill` без `fill_type="solid"` не закрашивает ячейку.

### Формулы — строки, не вычисления

```python
ws["D2"] = "=SUM(B2:B10)"
ws["E2"] = '=IF(B2>0,"да","нет")'
```

openpyxl **не вычисляет** формулы — только записывает строку. Файл, не открывавшийся в Excel, содержит пустой кэш значений:

- `load_workbook(path)` вернёт формулу (проверено: `"=SUM(B2:B4)"`); `data_only=True` — последнее вычисленное значение, а для скриптового файла — `None` (проверено).

### Объединение, закрепление, фильтр, картинки

```python
ws.merge_cells("A7:B8")
ws.freeze_panes = "A2"                        # шапка закреплена
ws.auto_filter.ref = "A8:B100"                # диапазон с заголовками
from openpyxl.drawing.image import Image as XLImage   # требует Pillow
img = XLImage("chart.png"); img.anchor = "D4"; ws.add_image(img)
```

Писать в объединённую область можно только в левую верхнюю ячейку диапазона.

### write_only — большие файлы

```python
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font

wb = Workbook(write_only=True)        # постоянная память, только append
ws = wb.create_sheet("Данные")
head = WriteOnlyCell(ws, value="Сумма"); head.font = Font(bold=True)
ws.append([head, "plain"])
ws.append([1, 2])
wb.save("big.xlsx")
```

Ограничения (проверены): `ws["A1"]` и `ws.cell(...)` бросают `TypeError`; дозапись только `append`; `freeze_panes`/`auto_filter.ref` задать можно; стиль — только через `WriteOnlyCell`.

## Общие паттерны

- **Markdown / ответ LLM**: минимальный конвертер — `#`→`add_heading(level)`, `-`→`List Bullet`, `**x**`→`run.bold=True`, `| a | b |`→`add_table`. Надёжнее просить LLM вернуть JSON (`sections: [{heading, paragraphs[], table:{header[], rows[][]}}]`) и рендерить детерминированным кодом; данные из ответа модели проходят те же проверки, что пользовательский ввод (типы, длина).
- **Шаблон vs с нуля**: шаблон (.docx/.xlsx с фирменными стилями) + заполнение — для бренд-бука и повторяемости (не удаляйте стили из шаблона — `doc.styles["X"]` бросит `KeyError`); генерация с нуля — для динамической структуры, с собственным словарём «роль → стиль».
- **Безопасные пути**: путь вывода из конфигурации, не из свободного текста; `os.path.join(out_dir, filename)` + проверка `os.path.abspath(...).startswith(os.path.abspath(out_dir) + os.sep)`; экранирование имени `re.sub(r'[\\/:*?"<>|]', '_', name)`; перезапись — через `os.replace` после сборки во временный файл рядом с целевым.

## Типичные ошибки

| Ошибка | Причина и исправление |
|---|---|
| Таблица без границ | Не задан `t.style = "Table Grid"` (по умолчанию `Normal Table`). |
| `data_only=True` вернул `None` | Файл не открывали в Excel — кэш значений пуст; формулы не вычисляются. |
| `TypeError` в write_only на `ws["A1"]` | Режим поддерживает только `append`/`WriteOnlyCell`. |
| Оглавление пустое / `KeyError` стиля | python-docx не обновляет поля: TOC field-код + Heading-стили + F9; `doc.styles["X"]` требует стиль в шаблоне. |
| Картинка растянута / `PatternFill` не красит | Не задан `width`/`height` в `add_picture`; для заливки нужен `fill_type="solid"`. |

## Документация

Сеть в этой сессии недоступна — доступность ссылок не проверена:

- python-docx: https://python-docx.readthedocs.io/en/stable/ (Quickstart, Tables, Sections)
- python-pptx: https://python-pptx.readthedocs.io/en/stable/ (Presentations, Shapes, Notes)
- openpyxl: https://openpyxl.readthedocs.io/en/stable/ ; картинки XLSX требуют Pillow: https://pillow.readthedocs.io/en/stable/
