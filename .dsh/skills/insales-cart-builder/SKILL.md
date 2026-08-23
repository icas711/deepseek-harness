---
name: insales-cart-builder
description: Сводный сценарий InSales — создание или капитальная переделка корзины на common.v2.js; связывает разметку формы (insales-cart), AJAX-запросы (insales-ajax), lodash-шаблонизатор (insales-templates) и карточку товара (insales-product) в пошаговый план
whenToUse: Когда на сайте InSales нужно сделать корзину с нуля или глубоко переработать существующую — страница корзины, динамический виджет корзины в шапке, миникорзина без перезагрузки; используйте как точку входа, загружая перечисленные скилы по шагам
---

# Создание корзины на InSales (сводный сценарий)

Оркестратор: не содержит новых фактов API, а задаёт порядок работы и указывает, какой скил загружать на каждом шаге. Все детали — в скилах-модулях.

## Шаг 0. Подключение фреймворка

Загрузить скил **`insales-product`** (раздел «Предусловия»): `{% include_insales_scripts "common-js@v2" %}` в `layouts.{layout,checkout2,client_account}.liquid` или `"common_js_version": "v2"` в `settings_data.json`. Проверить, что не переопределяются зарезервированные глобалы (`Cart`, `Site`, …). Для шаблонов 4 поколения — common-js как зависимость виджета (`libraries` в info.json, скил `insales-widgets`).

## Шаг 1. Статическая страница корзины (liquid)

Загрузить **`insales-cart`**. Разметить форму:

- корень: `<form data-cart-form action="{{ cart_items }}" method="post">`, для работы скидок без перезагрузки — `data-reload-on-coupon="false"`;
- каждая позиция: `data-product-id="{{ item.product.id }}" data-item-id="{{ item.id }}"`;
- количество: обёртка `data-quantity` + кнопки `data-quantity-change` + инпут `name="cart[quantity][{{ item.id }}]"`;
- цены: `data-cart-item-price`, `data-cart-item-total-price`, `data-cart-total-price`, `data-cart-full-total-price`;
- счётчики: `data-cart-positions-count`, `data-cart-item-count`;
- купон: `name="cart[coupon]"` + `data-coupon-submit`; скидки `data-cart-discounts-ajax`, ошибки `data-cart-discounts-error`;
- удаление/очистка: `data-item-delete="{{ item.id }}"`, `data-cart-clear`.

Канонический пример целиком — в `insales-cart` (раздел «Канонический пример разметки»).

## Шаг 2. Динамический виджет корзины (миникорзина в шапке)

Загрузить **`insales-templates`**. Паттерн: подписка на обновление → рендер lodash-шаблоном → реинициализация:

```js
EventBus.subscribe("update_items:insales:cart", function(cart) {
  $(".js-dynamic_basket").html(Template.render(cart, "dynamic_basket"));
  InSalesUI.initAjaxInstance($(".js-dynamic_basket"));
});
```

- шаблон оформить как `<script type="text/template" data-template-id="dynamic_basket">`;
- данные корзины в шаблоне: `order_lines[]` (`id`, `product_id`, `title`, `quantity`, `sale_price`, `first_image.medium_url`), `total_price`;
- деньги — `Shop.money.format(...)` (скил `insales-helpers`);
- **обязательно** вызывать `InSalesUI.initAjaxInstance` после каждого ререндера — иначе data-атрибуты позиций перестают работать;
- полный исходник шаблона — `insales-templates/references/dynamic-basket.md`.

## Шаг 3. Кнопки добавления в карточках товара

Загрузить **`insales-product`**. Форма товара с `data-product-id`, кнопка `data-item-add`, счётчик-компонент `data-add-cart-counter` для шаблонов 4 поколения, `data-quick-checkout` для покупки в один клик. Если карточки подгружаются AJAX-ом (виджеты SP9/SP12/SP16) — `insales-ajax-products`.

## Шаг 4. Собственная логика без data-атрибутов (если нужна)

Загрузить **`insales-ajax`**: `ajaxAPI.cart.add/get/remove/update` (Deferred, без публикации EventBus-событий — в отличие от класса `Cart`). События корзины и позиций (`add_items:insales:cart`, `change_quantity:insales:item` и т.д.) — в `insales-cart`; шина — `insales-eventbus` (обработчик сработает даже на событие, случившееся до подписки).

## Шаг 5. Оформление заказа

Программно — `ajaxAPI.checkout.order(client, order)` (скил `insales-ajax`); формой — `data-cart-submit` в разметке шага 1; заявки и заказ в один клик — скил `insales-product` (раздел «Формы заявки и заказа в один клик»).

## Чек-лист приёмки

- [ ] common-js@v2 подключён, глобалы не переопределены;
- [ ] форма корзины: корневые атрибуты + атрибуты каждой позиции;
- [ ] после каждого динамического ререндера вызван `InSalesUI.initAjaxInstance`;
- [ ] купон/скидки работают без перезагрузки (`data-reload-on-coupon="false"` + блоки скидок);
- [ ] все обращения к API — после `DOMContentLoaded`;
- [ ] обновление виджета подписано на `update_items:insales:cart` (и `:light`-вариант, если тяжёлый не нужен);
- [ ] `Shop.money.format` для всех выводов цен.

## Карта скилов

| Задача | Скил |
|---|---|
| Подключение, карточка товара, кнопки, 1-клик | `insales-product` |
| Форма корзины, класс `Cart`, события корзины/позиций | `insales-cart` |
| Lodash-шаблоны, `InSalesUI`, динамическая корзина | `insales-templates` |
| Прямые AJAX-запросы, checkout | `insales-ajax` |
| События, отладка (`EventBus.logger.add('cart')`) | `insales-eventbus` |
| `Shop.money.format` и прочие утилиты | `insales-helpers` |
| Виджеты 4 поколения (обёртка для блоков корзины) | `insales-widgets` |
