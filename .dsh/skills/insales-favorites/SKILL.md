---
name: insales-favorites
description: Модуль «Избранное» JS-библиотеки common.v2.js InSales — кнопки и счётчик избранного, страница /favorites, класс FavoritesProducts и его события
whenToUse: При добавлении на сайт InSales функционала избранного (wishlist) — кнопки добавления/удаления/переключения, счётчик, страница избранного, программная работа через класс FavoritesProducts
---

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

- `insales-compare` — аналогичный модуль сравнения.
- `insales-eventbus` — шина событий.
