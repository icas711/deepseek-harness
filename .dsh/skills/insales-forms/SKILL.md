---
name: insales-forms
description: Формы с AJAX-отправкой из common.v2.js InSales — обратная связь, отзыв к товару, комментарий к статье; валидация полей, сообщения об успехе, Google reCaptcha v2/v3 и Yandex SmartCaptcha, CSRF-токен
whenToUse: При создании или редактировании форм обратной связи, отзывов к товарам или комментариев к статьям на сайте InSales — разметка с data-атрибутами, валидация, капчи (в т.ч. invisible), модальные окна, обработка CSRF-ошибок
---

# Формы: обратная связь, отзыв, комментарий (common.v2.js, InSales)

Три компонента с одинаковой архитектурой. Общие части (капчи, успех, модалки) описаны один раз ниже; различия — в таблицах полей.

Письма обратной связи приходят на E-mail для уведомлений из админ-панели «Настройки → Карточка магазина». Отзывы — «Товары → Отзывы», комментарии — «Сайт → Блог и статьи → Комментарии».

## Общая архитектура

| Роль | Атрибут |
|---|---|
| Обёртка формы (обязательна) | `<префикс>-form-wrapper` |
| Сообщение об успехе | `<префикс>-form-success` |
| Блок поля (валидация, ошибки) | `<префикс>-form-field-area` |
| Поле ввода | `<префикс>-form-field` |
| Вывод ошибки поля | `<префикс>-form-field-error` |
| Google reCaptcha | `<префикс>-form-recaptcha` |
| Yandex SmartCaptcha | `<префикс>-form-yandex-captcha` |
| Кнопка модального окна | `data-show-<префикс>-modal` |

Префиксы: `data-feedback` (обратная связь), `data-reviews` (отзыв), `data-comments` (комментарий).

### Сообщение об успехе

```liquid
<div data-feedback-form-success='{"showTime": 10000}'>Успешно отправлено</div>
```

У отзыва и комментария в JSON также `message` (текст) и `reloadPage` (перезагружать ли страницу). При успехе элемент получает класс `is-show`, снимаемый через `showTime` мс. По умолчанию элемент не скрыт — скрывайте CSS-ом до `is-show`.

### Поля ввода

Вид поля определяется по `name`. JSON значения поля: `isRequired`, `errorMessage`, для телефона — `phoneNumberLength` и `secondPhoneNumberLength` (ожидаемое число цифр).

### Капчи

Google reCaptcha v2 — блок `<префикс>-form-recaptcha`. v3 (invisible, проверка автоматически при отправке): добавить `data-recaptcha-type="invisible"`; `data-badge`: `inline` (как v2, без чекбокса) | `bottomleft` (по умолчанию) | `bottomright`.

Yandex SmartCaptcha (тип капчи выбирается в админке «Настройки → Карточка магазина»): `<префикс>-form-yandex-captcha`. Атрибуты: `data-yandex-captcha-test="true"` (тестовый режим — всегда показывает задание), `data-yandex-captcha-type="invisible"`, `data-yandex-captcha-shield-position` (`top-left`, `center-left`, `bottom-left`, `top-right`, `center-right`, `bottom-right`; по умолчанию `bottom-right`), `data-yandex-captcha-hide-shield="true"`.

При скрытии бейджа или invisible-капче обязательно уведомлять пользователей, что их данные обрабатывает SmartCaptcha, иным способом.

### Модальные окна

```liquid
<button data-show-feedback-modal='{"modal_id": "123456"}'>Обратная связь</button>
```

`modal_id` удобен при нескольких формах в модалках. Нажатие публикует событие `show-modal-<feedback|reviews|comments>:insales:ui_<feedback|reviews|comments>`.

## Обратная связь

`action="/client_account/feedback"`. Поля по `name`: `from` (e-mail), `phone`, `name`, `content`, `subject`, `agree` (чекбокс согласия — `data-feedback-form-agree`).

Обязательны по умолчанию: `from` (можно отключить) и `agree` (отключить нельзя). Поля `from`/`content` можно сделать необязательными — при отправке подставляется системный текст (e-mail владельца магазина; «Сообщение не заполнено»). Несколько отдельных полей текста объединяются JavaScript-ом (пример — виджет FF2 в шаблонах 4 поколения).

События: `send-feedback:insales:ui_feedback`, `error-feedback:insales:ui_feedback`, `show-modal-feedback:insales:ui_feedback`.

### CSRF-токен

В кастомных формах возможна ошибка «Invalid CSRF token» — страницы кэшируются и токен устаревает. Актуальный токен в cookies:

```js
function getCookieByKey(key) {
  const name = key + "=";
  const decodedCookies = decodeURIComponent(document.cookie);
  const cookieArray = decodedCookies.split(';');
  for (let i = 0; i < cookieArray.length; i++) {
    let cookie = cookieArray[i].trim();
    if (cookie.indexOf(name) === 0) {
      return cookie.substring(name.length, cookie.length);
    }
  }
  return null;
}

getCookieByKey('x_csrf_token');
```

Стандартные формы common.js учитывают это сами через актуальный мета-тег.

Полный пример разметки: [references/feedback-form.md](references/feedback-form.md).

## Отзыв к товару

Условие вывода: `account.reviews_enabled?`. Обёртка:

```liquid
<form
  data-reviews-form-wrapper='{
    "reviews_moderated": {{ account.reviews_moderated? }},
    "url": "{{ product.url }}"
  }'
  method="post"
  action="{{ product.url }}/reviews#review_form"
  enctype="multipart/form-data"
>
```

Поля по `name`: `review[author]`, `review[email]`, `review[content]` — все обязательны; `review[image_attributes][image]` — файл изображения (необязателен, условие `account.reviews_images_enabled?`, атрибут `data-reviews-form-image`); `review[rating]` — радио 1..5.

События: `send-review:insales:ui_reviews`, `error-reviews:insales:ui_reviews`, `show-modal-reviews:insales:ui_reviews`.

Полный пример: [references/reviews-form.md](references/reviews-form.md).

## Комментарий к статье

Условие вывода: `blog.comments_enabled?`. Обёртка:

```liquid
<form
  data-comments-form-wrapper='{
    "reviews_moderated": {{ account.reviews_moderated? }},
    "url": "{{ article.url }}"
  }'
  method="post"
  action="{{ article.url }}/comments#comment_form"
>
```

Поля по `name`: `comment[author]`, `comment[email]`, `comment[content]` — все обязательны.

События: `send-comment:insales:ui_comments`, `error-comments:insales:ui_comments`, `show-modal-comments:insales:ui_comments`.

Полный пример: [references/comments-form.md](references/comments-form.md).

## Смежные скилы

- `insales-ajax` — программная отправка (`ajaxAPI.shop.message` / `review` / `comment`) без разметочных компонентов.
- `insales-render` — шина событий EventBus.
