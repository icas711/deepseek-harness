---
name: insales-ui-lists
description: Живой поиск, сравнение и избранное из JS-библиотеки common.v2.js InSales — AjaxSearch (форма, setConfig, события), кнопки и счётчики Compare и FavoritesProducts, страницы /compares и /favorites, классы и их события
whenToUse: При создании или редактировании живого (AJAX) поиска по сайту InSales — форма с выпадающими результатами, настройка порога и задержки через AjaxSearch.setConfig; при добавлении функционала сравнения товаров (кнопки, счётчик, страница /compares, класс Compare) или избранного/wishlist (кнопки, счётчик, страница /favorites, класс FavoritesProducts)
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

# Избранное (common.v2.js, InSales)

Страница избранного доступна во всех магазинах по адресу `/favorites`. Содержимое редактируется файлом `templates/favorite.liquid`; массив товаров — в Liquid-переменной `products`. В избранные добавляются только товары; выбранные варианты не сохраняются.

Список хранится в аккаунте пользователя и одинаков на всех его устройствах. Кэшируется на 15 секунд — при быстром добавлении с разных устройств или разлогинивании счётчик может показывать старые значения.

Предусловия — скил `insales-product`: подключение common.v2.js, зарезервированные глобалы (`FavoritesProducts` не переопределять).

## Атрибуты

| Атрибут | Назначение |
|---|---|
| `data-ui-favorites-add="{{ product.id }}"` | Кнопка добавления; класс `favorites-added`. |
| `data-ui-favorites-delete="{{ product.id }}"` | Кнопка удаления; класс `favorites-not-added`. |
| `data-ui-favorites-trigger="{{ product.id }}"` | Переключатель добавить/удалить; классы `favorites-added` / `favorites-not-added`. |
| `data-ui-favorites-trigger-added-text` / `data-ui-favorites-trigger-not-added-text` | Дочерний элемент переключателя для смены текста. |
| `data-ui-favorites-clear` | Кнопка удаления всех избранных товаров. |
| `data-ui-favorites-counter-btn` | Ссылка на `/favorites`; класс `favorites-empty`, когда пусто. |
| `data-ui-favorites-counter` | Счётчик товаров в избранном. |

```liquid
<button data-ui-favorites-add="{{ product.id }}">Добавить товар в избранное</button>
<button data-ui-favorites-delete="{{ product.id }}">Удалить из избранных</button>

<button data-ui-favorites-trigger="{{ product.id }}">
  <span
    data-ui-favorites-trigger-added-text="В избранном"
    data-ui-favorites-trigger-not-added-text="Добавить в избранное"
  ></span>
</button>

<button data-ui-favorites-clear>Очистить</button>
<a href="/favorites" data-ui-favorites-counter-btn>Избранное</a>
<span data-ui-favorites-counter></span>
```

## Класс FavoritesProducts

```js
var favoritesState = FavoritesProducts.getFavoritesProducts(); // текущее состояние

FavoritesProducts.add({ item: 123456 });    // item — ID товара
FavoritesProducts.remove({ item: 123456 });
FavoritesProducts.update();                 // обновить состояние
```

Очистка всего списка в документации показана как `FavoritesProducts.remove()` без аргументов (вероятная опечатка; по смыслу — «очистить избранное», у аналогичного Compare для этого есть `clear()`). Проверьте на живом магазине, вызывает ли `clear()` или `remove()` без аргументов полную очистку.

## События

| Событие | Описание |
|---|---|
| `before:insales:favorites_products` | Перед любым взаимодействием с компонентом. |
| `always:insales:favorites_products` | После любого взаимодействия. |
| `update_items:insales:favorites_products` | Список избранного обновлён. |
| `add_item:insales:favorites_products` | Товар добавлен. |
| `remove_item:insales:favorites_product` | Товар удалён (суффикс без `_products` — так в документации). |
| `overload:insales:favorites_products` | Достигнуто максимальное количество избранных. |

```js
EventBus.subscribe('add_item:insales:favorites_products', function (data) {
  console.log('Товар добавлен в избранное', data);
});
```

## Смежные скилы

- `insales-render` — шина событий EventBus: подписка, публикация, логгер; lodash-шаблоны.
