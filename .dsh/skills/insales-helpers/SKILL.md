---
name: insales-helpers
description: Вспомогательные методы и reCaptchaCommon API из common.v2.js InSales — Shop.money.format, Shop.config, Trigger Events (data-trigger-click), подключение Google reCaptcha v2/v3 к кастомным формам с CSRF-токеном
whenToUse: При форматировании цен в скриптах InSales (Shop.money.format), получении product-id или конфигурации магазина, публикации EventBus-событий по клику на элемент, а также при ручном подключении Google reCaptcha (v2 или v3 Invisible) к собственной форме с AJAX-отправкой
---

# Вспомогательные методы и reCaptchaCommon (common.v2.js, InSales)

## Объект Shop

`Shop` — зарезервированная глобальная переменная, не переопределять.

```js
// Форматирование суммы согласно настройкам админ-панели
Shop.money.format(1234.00); // "1234 руб."

// product-id на странице товара; на остальных страницах null
// (имя метода именно getProducId — как в документации)
Shop.config.getProducId(); // "70513124" | null

// Конфигурация
Shop.config.get();
```

## Trigger Events

Клик по элементу с `data-trigger-click` публикует EventBus-событие с указанным названием:

```html
<button data-trigger-click="my_button:insales:site">Кнопка</button>
```

```js
EventBus.subscribe('my_button:insales:site', data => {
  console.log('My button', data.event_target); // элемент, по которому кликнули
});
```

## reCaptchaCommon API

Для кастомных форм, где готовые компоненты `insales-forms` не подходят.

### render

```js
/**
 * @param {DOMelement} recaptchaBlock - пустой DOM-элемент для рендера капчи
 * @param {String} formType - 'feedback' | 'comment' | 'review'
 */
reCaptchaCommon.render(document.querySelector('.js-captcha-block'), 'feedback');
```

Загружает скрипт Google ReCaptcha (если ещё не загружен) и рендерит капчу в переданном элементе (элемент обязан быть пустым). Без аргументов — только загрузка скрипта. Если у блока есть `data-recaptcha-type="invisible"` — рендерится v3. Перед отправкой формы взять `value` у элемента `[name="g-recaptcha-response"]`.

### executeInvisible (v3)

```js
/**
 * @param {DOMElement} form - форма
 * @param {function} callback - вызовется после верификации с аргументами (form, token)
 * @param {string} formType - тип формы
 * @returns {string|null} токен, либо null — отправку нужно отменить
 */
const token = reCaptchaCommon.executeInvisible(form, sendFeedbackForm, 'feedback');
if (!token) { return } // верификация ещё идёт; форма уйдёт из callback
```

Для v3 обязательно скрытое поле `<input type="hidden" name="recaptcha_type" value="invisible">` — серверу нужен тип, у версий разные ключи проверки токена. Бейдж: `data-badge` на блоке капчи — `inline` | `bottomleft` (по умолчанию) | `bottomright`.

### CSRF-токен и отправка

Токен — из `meta[name='csrf-token']`; заголовок `X-CSRF-Token`:

```js
const csrfTokenElement = document.querySelector("meta[name='csrf-token']");
if (csrfTokenElement) {
  $.ajaxSetup({ headers: { 'X-CSRF-Token': csrfTokenElement.content } });
} else {
  console.error('CSRF token meta tag not found. AJAX requests may fail.');
}
$.post('/client_account/feedback.json', feedback).done(function (done) { console.log(done); });
```

Полные рабочие примеры форм (v2 и v3): [references/recaptcha-examples.md](references/recaptcha-examples.md).

## Смежные скилы

- `insales-forms` — готовые разметочные формы с капчами (обычный путь).
- `insales-ajax` — `ajaxAPI.shop.message/review/comment` как альтернатива ручному `$.post`.
- `insales-render` — `Shop.money.format` внутри lodash-шаблонов.
