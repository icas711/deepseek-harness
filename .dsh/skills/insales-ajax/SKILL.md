---
name: insales-ajax
description: Модуль ajaxAPI из JS-библиотеки common.v2.js InSales — прямые AJAX-запросы к магазину (корзина, клиент, товары, категории, отзывы, комментарии, обратная связь, оформление заказа, сравнение)
whenToUse: При написании клиентских скриптов для InSales, которым нужны данные магазина напрямую через ajaxAPI — собственные виджеты корзины без data-атрибутов, динамическая подгрузка товаров/коллекций, отправка отзывов/комментариев/сообщений, программное оформление заказа
---

# Модуль ajaxAPI (common.v2.js, InSales)

Инструмент для получения и обновления данных магазина без перезагрузки страницы. `ajaxAPI` — зарезервированная глобальная переменная, не переопределять. Все методы возвращают Deferred (`.done` / `.fail`). Обращения — после `DOMContentLoaded`.

Разметочные компоненты (корзина, формы и т.д.) — смежные скилы `insales-cart`, `insales-forms`; этот скил — про программный API.

## Корзина

```js
// Добавление: items {variant_id: quantity}, options {comments: {variant_id: comment}, coupon}
ajaxAPI.cart.add(
  { 123456: 1, 123457: 3, 123450: 100 },
  { comments: { 123456: 'Ваш комментарий' }, coupon: 'test' }
)
  .done(function (onDone) { console.log('onDone: ', onDone) })
  .fail(function (onFail) { console.log('onFail:', onFail) });

// Состав корзины
ajaxAPI.cart.get().done(...).fail(...);

// Удаление позиции (один ID модификации)
ajaxAPI.cart.remove(123123).done(...).fail(...);

// Обновление: quantity = 0 удаляет позицию, иначе устанавливает количество
var items = { 123456: 1, 123457: 3, 123450: 100 };
var options = { comments: { 123456: 'Ваш комментарий' }, coupon: 'test' };
ajaxAPI.cart.update(items, options).done(...).fail(...);
```

## Клиент

```js
// Залогинен: { status: "ok", client: { ... } }
// Не залогинен: { status: "error", message: "Not authorized", url: "/client_account/session/new" }
ajaxAPI.shop.client.get().done(...).fail(...);
```

## Товары

```js
ajaxAPI.product.get(123456).done(...).fail(...);
ajaxAPI.product.getList([123456, 123457, 123458, 123459], { no_cache: true })
  .done(...).fail(...);
```

Кэширование: товары кэшируются в local storage в рамках одной сессии (перезагрузка сбрасывает); обход — `{ no_cache: true }` вторым аргументом. Лимит 700 товаров на запрос, сверх — массив обрезается.

## Категория (коллекция)

```js
/**
 * @param {string} handle пермалинк коллекции (обязателен)
 * @param {Object} filter { price_min, price_max, characteristics: [id, ...] }
 * @param {Object} pager  { page_size, page }
 */
var filter = { price_min: 4000, price_max: 10000, characteristics: [18775928, 18775929] };
var pager = { page_size: 25, page: 2 };
ajaxAPI.collection.get('collection_handle', filter, pager).done(...).fail(...);
```

## Оформление заказа

Все поля обязательны:

```js
/**
 * @param {Object} client { email, name, phone }
 * @param {Object} order  { delivery: id способа доставки, payment: id способа оплаты }
 */
ajaxAPI.checkout.order(
  { email: 'user@mail.ru', name: 'user', phone: '79879991122' },
  { delivery: 1111111, payment: 2222222 }
).done(...).fail(...);
```

## Отзывы, комментарии, обратная связь

```js
// Отзыв к товару: author, email, content, капча — обязательны; rating опционален
var reviewOption = { author: 'Пользователь', email: 'user@mail.ru', content: 'Текст отзыва', rating: 5 };
if ($('#recaptcha-token').length) {
  reviewOption['g-recaptcha-response'] = $('#recaptcha-token').val();
} else {
  reviewOption['captcha_solution'] = $('[name="review[captcha_solution]"]').val();
}
ajaxAPI.shop.review(reviewOption, '/collection/shop/product/main').done(...).fail(...);

// Комментарий к статье: author, email, content, капча — обязательны
ajaxAPI.shop.comment(commentOption, '/blogs/blog/aktsiya').done(...).fail(...);

// Обратная связь: поля вида feedback[...]; from и content обязательны
let feedback = {
  'feedback[name]': 'Test',
  'feedback[from]': 'test@insales.ru',
  'feedback[phone]': '00000000000',
  'feedback[subject]': 'Обратная связь',
  'feedback[content]': 'Без сообщения'
};
// при установленной галочке reCaptcha добавить feedback['g-recaptcha-response']
ajaxAPI.shop.message(feedback, { subject: 'Тема письма' }).done(...).fail(...);
```

Для отправки этих форм разметкой (валидация, сообщения об успехе, капчи) — скил `insales-forms`.

## Сравнение

```js
ajaxAPI.compare.add(123456).done(...).fail(...);
ajaxAPI.compare.remove(123456).done(...).fail(...);
ajaxAPI.compare.get().done(...).fail(...);
```

## Смежные скилы

- `insales-cart` — разметочная корзина и класс `Cart` (в отличие от `ajaxAPI.cart` публикует EventBus-события).
- `insales-forms` — формы обратной связи, отзывов и комментариев на data-атрибутах.
- `insales-product` — подключение common.v2.js, класс `Products`.
