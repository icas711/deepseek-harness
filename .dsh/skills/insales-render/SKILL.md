---
name: insales-render
description: EventBus и lodash-шаблоны common.v2.js InSales — подписка/публикация событий компонентов, Template.load/render, InSalesUI.initAjaxInstance, динамическая корзина через EventBus + Template.render
whenToUse: При написании клиентских скриптов для сайта InSales, которым нужно реагировать на события common.v2.js (обновление корзины, выбор варианта, поиск и т.д.) или публиковать собственные; при динамическом рендере компонентов lodash-шаблонами — виджет корзины без перезагрузки, перевёрстка отрендеренного блока, реинициализация формы корзины после перерисовки; при отладке потока событий через EventBus.logger
---

# EventBus (common.v2.js, InSales)

Шина событий для взаимодействия базового функционала common.v2.js с остальными скриптами без привязки к вёрстке и вспомогательным объектам.

Модель Pub/Sub, построена на Deferred:

- к одному событию (Издателю) привязывается несколько обработчиков (Подписчиков);
- обработчики сработают, даже если событие произошло **раньше** подписки;
- порядок объявления Издателя и Подписчиков не важен.

`EventBus` — зарезервированная глобальная переменная, не переопределять.

## subscribe

Издатели объявлены внутри API common.v2.js; в пользовательском коде привязываются подписчики.

```js
/**
 * @param {String}   eventId  название события
 * @param {function} callback обработчик события
 */
EventBus.subscribe('add_items:insales:cart', function (data) {
  console.log('add_items:insales:cart:', data);
});
```

В данных подписчика всегда доступен объект `action` со свойством `method` и дополнительными сведениями в зависимости от события:

- ссылка на jQuery-объект DOM-узла, с которым произошло взаимодействие;
- обновлённые данные компонента (`Cart`, `Products` и т.д.).

Остальные поля смотрите через `console.log` или `EventBus.logger`.

## publish

```js
/**
 * @param {String} eventId название события
 * @param {Object} data    любой тип данных, преимущественно Object
 */
EventBus.publish('event_id', {
  isTest: true,
  title: 'Test',
  status: 'ok'
});
```

## Trigger Events

Клик по элементу с `data-trigger-click` (значение — название события) публикует EventBus-событие:

```html
<button data-trigger-click="my_button:insales:site">Кнопка</button>
```

```js
EventBus.subscribe('my_button:insales:site', data => {
  console.log('My button', data.event_target); // элемент, по которому кликнули
});
```

## logger.add

Логгер потока событий компонента для отладки:

```js
EventBus.logger.add('cart');
EventBus.logger.add('product');
```

Компоненты: `cart`, `product`, `search`, `compares`, `favorites_products`, `quick_checkout`.

## Каталог событий компонентов

Конкретные события и их данные — в скилах соответствующих модулей: `insales-cart` (корзина и позиции), `insales-product` (товар), `insales-ui-lists` (поиск, сравнение, избранное).

Именование: `<действие>:insales:<компонент>`, обёрточные `before:insales:<компонент>` / `always:insales:<компонент>` вокруг каждой операции, варианты `:light` — без тяжёлых вложенных данных (например, без `product` в `order_lines` корзины).

# Lodash-шаблоны и UI (common.v2.js, InSales)

## Класс Template

Хранение и получение шаблонов на шаблонизаторе Lodash. `Template` — зарезервированная глобальная переменная, не переопределять.

### Разметка шаблона

```html
<script type="text/template" data-template-id="option-select">
  <div class="<%= classes.option %> is-select">
    <label class="<%= classes.label %>"><%= title %></label>
    <select class="<%= classes.values %>" data-option-bind="<%= option.id %>">
      <% _.forEach(values, function (value){ %>
        <option <%= value.controls %> <%= value.state %>><%= value.title %></option>
      <% }) %>
    </select>
  </div>
</script>
```

Интерполяция `<%= %>`, логика `<% %>` — стандартный Lodash.

### Методы

```js
/**
 * @param {string} template_body - вёрстка шаблона
 * @param {string} template_id  - название шаблона
 */
Template.load('<button class="button button--click_me"><%= title %></button>', 'test-button');

/**
 * @param {Object} templateData - данные для шаблонизатора
 * @param {string} template_id  - название шаблона
 * @returns {string} HTML-строка
 */
$(targetNode).html(Template.render({ title: 'Click me!' }, 'test-button'));
```

## InSalesUI

### initAjaxInstance

Инициализация формы корзины в переданном jQuery-узле — обязательна после каждой перерисовки корзины шаблоном, иначе data-атрибуты позиции (`data-quantity`, `data-item-delete` и т.д.) перестают работать:

```js
/**
 * @param {jquery} jquery-объект
 */
InSalesUI.initAjaxInstance($(".js-dynamic_basket"));
```

### bindUpdateCart

Обновление слушателей quantity в форме корзины.

## Динамическая корзина (канонический паттерн)

Подписка на обновление корзины → рендер шаблоном → реинициализация:

```js
EventBus.subscribe("update_items:insales:cart", function(cart) {
  $(".js-dynamic_basket").html(Template.render(cart, "dynamic_basket"));
  InSalesUI.initAjaxInstance($(".js-dynamic_basket"));
});
```

В шаблоне доступны данные корзины: `order_lines[]` (`id`, `product_id`, `title`, `quantity`, `sale_price`, `first_image.medium_url`), `total_price`; форматирование денег — `Shop.money.format(...)` (скил `insales-helpers`).

Полный исходник шаблона `dynamic_basket` с формой, счётчиками количества и удалением позиций: [references/dynamic-basket.md](references/dynamic-basket.md).

## Смежные скилы

- `insales-cart` — атрибуты формы корзины и класс `Cart`.
- `insales-helpers` — `Shop.money.format` и прочие утилиты.
