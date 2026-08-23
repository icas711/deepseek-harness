---
name: insales-search
description: Живой поиск по сайту из JS-библиотеки common.v2.js InSales — атрибуты формы поиска, класс AjaxSearch и его события
whenToUse: При создании или редактировании живого (AJAX) поиска по сайту InSales — форма поиска с выпадающими результатами, настройка порога срабатывания и задержки через AjaxSearch.setConfig
---

# Живой поиск (common.v2.js, InSales)

Предусловия — скил `insales-product`: подключение common.v2.js, зарезервированные глобалы (`AjaxSearch` не переопределять).

## Атрибуты (все на теге form)

| Атрибут | Назначение |
|---|---|
| `data-search-field` | Поле для ввода поискового запроса. |
| `data-search-result` | Блок, в который записывается результат поиска. |
| `[name="lang"]` | Скрытый инпут текущего языка. |

## Разметка

```liquid
<form action="/search" method="get">
  <input type="hidden" name="lang" value="{{ language.locale }}">
  <input type="text" name="q" value="" placeholder="Поиск" data-search-field />
  <button type="submit">Поиск</button>
  <div data-search-result></div>
</form>
```

## AjaxSearch.setConfig

```js
/**
 * @param {number}  letters                с какого символа начинать поиск
 * @param {number}  delay                  задержка между запросами, мс
 * @param {boolean} hide_items_out_of_stock скрывать товары не в наличии
 */
AjaxSearch.setConfig({
  letters: 3,
  delay: 300,
  hide_items_out_of_stock: true
});
```

## События

| Событие | Описание |
|---|---|
| `before:insales:search` | Перед любым взаимодействием с компонентом поиска. |
| `update:insales:search` | После обновления результатов поиска. |
| `always:insales:search` | После любого взаимодействия. |

```js
EventBus.subscribe('update:insales:search', function (data) {
  console.log(data);
});
```

## Смежные скилы

- `insales-eventbus` — шина событий: подписка, публикация, логгер.
