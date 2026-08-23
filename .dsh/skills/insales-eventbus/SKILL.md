---
name: insales-eventbus
description: Шина событий EventBus из JS-библиотеки common.v2.js InSales — подписка на события компонентов (cart, product, search и др.), публикация своих событий, логгер отладки
whenToUse: При написании клиентских скриптов для сайта InSales, которым нужно реагировать на события common.v2.js (обновление корзины, выбор варианта, поиск и т.д.), при публикации собственных событий или отладке потока событий через EventBus.logger
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

Конкретные события и их данные — в скилах соответствующих модулей: `insales-cart` (корзина и позиции), `insales-product` (товар), `insales-search` (поиск), `insales-compare` (сравнение), `insales-favorites` (избранное).

Именование: `<действие>:insales:<компонент>`, обёрточные `before:insales:<компонент>` / `always:insales:<компонент>` вокруг каждой операции, варианты `:light` — без тяжёлых вложенных данных (например, без `product` в `order_lines` корзины).
