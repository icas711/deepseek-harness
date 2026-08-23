---
name: insales-cart
description: Модуль «Корзина» JS-библиотеки common.v2.js платформы InSales — data-атрибуты формы корзины и карточки позиции, класс Cart (add/delete/set/setCoupon и др.), события корзины и позиций
whenToUse: При создании или редактировании страницы корзины InSales, виджета корзины, купонов и скидок в корзине, а также при программной работе с корзиной через класс Cart (добавление, удаление, очистка, установка количества, купоны)
---

# Модуль «Корзина» (common.v2.js, InSales)

Предусловия — скил `insales-product`: подключение common.v2.js (`{% include_insales_scripts "common-js@v2" %}`), зарезервированные глобалы (`Cart` не переопределять), обращения к API после `DOMContentLoaded`.

## Атрибуты

Корневой элемент:

| Атрибут | Назначение |
|---|---|
| `data-cart-form` | Обязательный атрибут тега form корзины: `<form data-cart-form action="{{ cart_items }}" method="post">`. |
| `data-reload-on-coupon="false"` | Отключить перезагрузку страницы после применения купона (по умолчанию перезагружает). |

Вложенные элементы:

| Атрибут | Назначение |
|---|---|
| `data-item-id="{{ item.id }}"` | Обязателен для позиций; ID позиции. |
| `data-product-id="{{ item.product.id }}"` | Обязателен для инициализации товара; ID товара. |
| `data-quantity` / `data-quantity-change` | Обёртка количества; имя инпута `cart[quantity][{{ item.id }}]`. |
| `data-cart-item-price` | Цена позиции. |
| `data-cart-item-total-price` | Итоговая цена позиции с учётом количества. |
| `data-cart-total-price` | Итог всех позиций без учёта скидок. |
| `data-cart-full-total-price` | Итог всех позиций с учётом скидок. |
| `data-cart-positions-count` | Количество позиций. |
| `data-cart-item-count` | Количество товаров. |
| `data-item-delete="{{ item.id }}"` | Кнопка удаления позиции. |
| `data-cart-discounts-ajax` | Вывод информации о скидках (на форме нужен `data-reload-on-coupon="false"`). |
| `data-cart-discounts-error` | Вывод ошибок купона/скидок. |
| `data-cart-clear` | Кнопка очистки корзины. |
| `data-coupon-submit` | Кнопка отправки купона (инпут `name="cart[coupon]"`). |

## Канонический пример разметки

```liquid
<form action="{{ cart_url }}" method="post" data-cart-form>
  <input type="hidden" name="_method" value="put">
  <input type="hidden" name="make_order" value="">

  {% for item in cart.items %}
    <div data-product-id="{{ item.product.id }}" data-item-id="{{ item.id }}">
      <div data-quantity>
        <input type="text" name="cart[quantity][{{ item.id }}]" value="{{ item.quantity }}">
        <span data-quantity-change="-1">-</span>
        <span data-quantity-change="1">+</span>
      </div>
      <span data-item-delete="{{ item.id }}">X</span>
    </div>
  {% endfor %}

  <div>
    <label>Купон</label>
    <input type="text" name="cart[coupon]" value="{{ cart.coupon }}" />
    <input type="button" value="Применить" data-coupon-submit/>
  </div>

  <input type="submit" value="Оформить" data-cart-submit>
  <button data-cart-clear>Очистить</button>
  <button data-cart-update>Обновить</button>
</form>
```

## Класс Cart

### add

```js
/**
 * @param {Object} items    вариант → количество: { variant_id: quantity }
 * @param {Object} comments ID варианта → текст комментария к позиции
 * @param {string} coupon   код купона
 */
Cart.add({
  items: {
    123456: 2,
    123457: 1
  },
  comments: {
    123457: 'Мой комментарий'
  },
  coupon: 'Мой купон'
});
```

События: `before:insales:cart`, `add_items:insales:cart`, `add_items:insales:cart:light`, `update_items:insales:cart`, `update_items:insales:cart:light`, `always:insales:cart`.

### delete

```js
Cart.delete({
  items: [160549240, 160549242] // массив ID вариантов
});
```

События: `before:insales:cart`, `delete_items:insales:cart`, `update_items(:light)`, `always:insales:cart`.

### clear

```js
Cart.clear();
```

События: `before:insales:cart`, `clear_items:insales:cart`, `update_items(:light)`, `always:insales:cart`.

### forceUpdate

Принудительное обновление данных корзины:

```js
Cart.forceUpdate();
```

### remove

Удаление заданного количества товаров:

```js
Cart.remove({
  items: {
    138231315: 1,
    138231316: 1
  }
});
```

События: `before:insales:cart`, `remove_items:insales:cart`, `update_items(:light)`, `always:insales:cart`.

### set

Устанавливает количество для каждой позиции:

```js
Cart.set({
  items: {
    138231315: 1,
    138231316: 1
  }
});
```

События: `before:insales:cart`, `set_items:insales:cart`, `update_items(:light)`, `always:insales:cart`.

### setCoupon

```js
Cart.setCoupon({
  coupon: 'Мой купон'
});
```

События: `before:insales:cart`, `set_coupon:insales:cart`, `update_items(:light)`, `always:insales:cart`.

### order.get / order.getItemByID

```js
var order = Cart.order.get();        // состав корзины
console.log(order);

var item = Cart.order.getItemByID(138231315); // позиция по ID
console.log(item);
```

Суффикс `:light` — в `order_lines` события нет объекта `product`.

## События

Подписка через `EventBus.subscribe('<событие>', function (data) { ... })`.

События класса Cart перечислены у каждого метода выше; общие обёрточные — `before:insales:cart` и `always:insales:cart` вокруг каждой операции.

События изменения позиции товара:

| Событие | Описание |
|---|---|
| `before:insales:item` | Перед взаимодействием с позицией. |
| `change_quantity:insales:item` | Изменение количества позиции. |
| `update_variant:insales:item` | Обновление варианта позиции. |
| `always:insales:item` | После взаимодействия с позицией. |

```js
EventBus.subscribe('add_items:insales:cart', function (data) {
  console.log('Товар добавлен');
});
```

## Смежные скилы

- `insales-product` — подключение common.v2.js, карточка товара, атрибуты quantity, класс Products.
- AJAX API магазина, EventBus, шаблонизатор корзины (liquid) — отдельные скилы по мере создания.
