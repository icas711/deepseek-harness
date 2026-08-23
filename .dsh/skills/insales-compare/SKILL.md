---
name: insales-compare
description: Модуль «Сравнение» JS-библиотеки common.v2.js InSales — кнопки и счётчик сравнения, страница /compares, класс Compare и его события
whenToUse: При добавлении на сайт InSales функционала сравнения товаров — кнопки добавления/удаления/переключения, счётчик, страница сравнения, программная работа через класс Compare
---

# Сравнение (common.v2.js, InSales)

Страница сравнения доступна во всех магазинах по адресу `/compares`. Содержимое редактируется файлом `templates/compare.liquid`; массив товаров — в Liquid-переменной `products`. В сравнение добавляются только товары; выбранные варианты не сохраняются.

Предусловия — скил `insales-product`: подключение common.v2.js, зарезервированные глобалы (`Compare` не переопределять).

## Атрибуты

| Атрибут | Назначение |
|---|---|
| `data-compare-add="{{ product.id }}"` | Кнопка добавления; после добавления получает класс `compare-added`. |
| `data-compare-delete="{{ product.id }}"` | Кнопка удаления; после удаления получает класс `compare-not-added`. |
| `data-compare-trigger="{{ product.id }}"` | Переключатель добавить/удалить; классы `compare-added` / `compare-not-added`. |
| `data-compare-trigger-added-text` / `data-compare-trigger-not-added-text` | Дочерний элемент переключателя для смены текста. |
| `data-compare-clear` | Кнопка удаления всех товаров из сравнения. |
| `data-compare-counter-btn` | Ссылка на `/compares`; класс `compare-empty`, когда пусто. |
| `data-compare-counter` | Счётчик товаров в сравнении. |

```liquid
<button data-compare-add="{{ product.id }}">Добавить товар в сравнение</button>
<button data-compare-delete="{{ product.id }}">Удалить из сравнения</button>

<button data-compare-trigger="{{ product.id }}">
  <span
    data-compare-trigger-added-text="В сравнении"
    data-compare-trigger-not-added-text="Добавить в сравнение"
  ></span>
</button>

<button data-compare-clear>Очистить сравнение</button>
<a href="/compares" data-compare-counter-btn="">Сравнение</a>
<span data-compare-counter></span>
```

## Класс Compare

```js
var compareState = Compare.getCompare(); // текущее состояние

Compare.add({ item: 123456 });    // item — ID товара
Compare.remove({ item: 123456 });
Compare.clear();                  // удалить все
Compare.update();                 // обновить состояние
```

## События

| Событие | Описание |
|---|---|
| `before:insales:compares` | Перед любым взаимодействием с компонентом сравнения. |
| `always:insales:compares` | После любого взаимодействия. |
| `update_items:insales:compares` | Обновление товаров в сравнении. |
| `add_item:insales:compares` | Добавление товара. |
| `remove_item:insales:compares` | Удаление товара. |
| `overload:insales:compares` | Достигнуто максимальное количество товаров в сравнении. |

```js
EventBus.subscribe('add_item:insales:compares', function (data) {
  console.log('Товар добавлен в сравнение', data);
});
```

## Смежные скилы

- `insales-favorites` — аналогичный модуль избранного.
- `insales-eventbus` — шина событий.
