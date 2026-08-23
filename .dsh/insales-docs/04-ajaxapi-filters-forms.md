# common.v2.js — ajaxAPI, AJAX-фильтры, формы (сырая документация, часть 4)

Источник: официальная документация InSales, скопировано пользователем.

## Модуль для работы с API магазина (ajaxAPI)

Разделы: Корзина, Клиент, Отзывы, Комментарии к статье, Обратная связь, Товары, Категория,
Оформление заказа, Сравнение. Все методы возвращают Deferred (.done/.fail).

### Корзина

- ajaxAPI.cart.add(items, options) — items: {variant_id: quantity}, options: { comments: {variant_id: comment}, coupon }.
- ajaxAPI.cart.get() — состав корзины.
- ajaxAPI.cart.remove(variant_id) — удаление (один id модификации).
- ajaxAPI.cart.update(items, options) — quantity 0 удаляет позицию; comments, coupon.
  (В доках опечатка: `ajaxAPI.cart.update(items, optins)`.)

### Клиент

- ajaxAPI.shop.client.get() — залогинен: { status: "ok", client: {...} };
  не залогинен: { status: "error", message: "Not authorized", url: "/client_account/session/new" }.

### Отзывы (товар)

- ajaxAPI.shop.review(review, productUrl) — review: author, email, content (обяз.),
  captcha_solution (обяз.), rating; при reCaptcha — g-recaptcha-response из #recaptcha-token,
  иначе captcha_solution из [name="review[captcha_solution]"].

### Комментарии к статье

- ajaxAPI.shop.comment(comment, articleUrl) — comment: author, email, content (обяз.),
  captcha_solution; капча аналогично отзыву.

### Обратная связь

- ajaxAPI.shop.message(message, options) — поля вида feedback[name], feedback[from] (обяз.),
  feedback[phone], feedback[subject], feedback[content] (обяз.); g-recaptcha-response при наличии;
  options.subject — тема письма.

### Товары

- ajaxAPI.product.getList(idList, { no_cache }) — кэш local storage в рамках сессии; лимит 700.
- ajaxAPI.product.get(id).

### Категория

- ajaxAPI.collection.get(handle, filter, pager) — filter: { price_min, price_max,
  characteristics: [id,...] }; pager: { page_size, page }.

### Оформление заказа

- ajaxAPI.checkout.order(client, order) — client: { email, name, phone }; order: { delivery, payment }.
  Все поля обязательны.

### Сравнение

- ajaxAPI.compare.add(id), remove(id), get().

## AJAX-фильтры

Инициализация после DOMContentLoaded на странице категории с формой data-ajax-filter.
Значение-объект: useImages (bool), visibleItemsSize (сколько значений показывать до «Показать всё»),
maxFilterItems: 0 — показывать все.

Фильтры получаются AJAX-запросом, каждая группа рендерится шаблоном и попадает в
[data-ajax-filter-items]. Шаблоны (5+1): price (data-ajax-filter-template-price), item
(data-ajax-filter-template-item), usual (data-ajax-filter-template-usual), color
(data-ajax-filter-template-color, картинки), numeric (data-ajax-filter-template-numeric),
preloader (data-ajax-filter-items-template-preloader). Шаблоны не вложены друг в друга — каждый
отдельный в форме, рекомендуется использовать все.

Диапазоны: data-ajax-filter-range, data-ajax-filter-range-field-min/max, имена price_min/price_max.
Скрытые поля формы: order, page_size, lang, q.

Событие: init-filter:ui-ajax-filter.

## Форма обратной связи

- data-feedback-form-wrapper — обязательная обёртка; action="/client_account/feedback".
- data-feedback-form-success='{"showTime": 10000}' — сообщение об успехе, класс is-show.
- data-feedback-form-field-area — блок поля; ошибки в [data-feedback-form-field-error].
- data-feedback-form-field='{"isRequired", "errorMessage", "phoneNumberLength",
  "secondPhoneNumberLength"}' — поля по name: from (email), phone, name, content, subject, agree.
  Обязательные по умолчанию: from (можно отключить) и agree (нельзя отключить).
  from/content можно сделать необязательными — подставляется системный текст (e-mail владельца,
  «Сообщение не заполнено»). Несколько полей текста объединять JS-ом (виджет FF2, шаблоны 4 поколения).
- data-feedback-form-recaptcha — Google reCaptcha v2; data-recaptcha-type="invisible" — v3;
  data-badge: inline | bottomleft | bottomright.
- data-feedback-form-yandex-captcha — Yandex SmartCaptcha (тип капчи в админке);
  data-yandex-captcha-test="true" — тестовый режим; data-yandex-captcha-type="invisible" —
  невидимая; data-yandex-captcha-shield-position: top-left/center-left/bottom-left/top-right/
  center-right/bottom-right (по умолчанию bottom-right); data-yandex-captcha-hide-shield="true" —
  скрыть бейдж (обязательно уведомлять пользователей об обработке данных иначе).
- data-show-feedback-modal='{"modal_id": "..."}' — кнопка вызова модалки; событие
  show-modal-feedback:insales:ui_feedback.
- События: send-feedback:insales:ui_feedback, error-feedback:insales:ui_feedback,
  show-modal-feedback:insales:ui_feedback.
- CSRF: ошибка "Invalid CSRF token" при кэшировании страниц; актуальный токен в cookies
  x_csrf_token (getCookieByKey('x_csrf_token')); стандартные формы common.js учитывают сами.

## Форма отзыва к товару

- data-reviews-form-wrapper='{"reviews_moderated": ..., "url": "{{ product.url }}"}' — обязательная
  обёртка; action="{{ product.url }}/reviews#review_form"; enctype="multipart/form-data".
- data-reviews-form-success='{"showTime", "message", "reloadPage"}'.
- data-reviews-form-field-area / data-reviews-form-field / data-reviews-form-field-error — поля по
  name: review[author], review[email], review[content] (все обязательны), review[image_attributes][image]
  (файл, необязателен; атрибут data-reviews-form-image), review[rating] (радио 1..5).
- Капча: data-reviews-form-recaptcha / data-reviews-form-yandex-captcha + общие атрибуты как в feedback.
- data-show-reviews-modal — модалка; событие show-modal-reviews:insales:ui_reviews.
- События: send-review:insales:ui_reviews, error-reviews:insales:ui_reviews,
  show-modal-reviews:insales:ui_reviews.
- Условия: account.reviews_enabled?, review.captcha_enabled?, account.reviews_images_enabled?,
  account.reviews_moderated? (сообщение о модерации).

## Форма комментария к статье

- data-comments-form-wrapper='{"reviews_moderated": ..., "url": "{{ article.url }}"}' — обёртка;
  action="{{ article.url }}/comments#comment_form".
- data-comments-form-success='{"showTime", "message", "reloadPage"}'.
- Поля по name: comment[author], comment[email], comment[content] — все обязательны.
- Капча и модалка — аналогично (data-comments-form-recaptcha, data-comments-form-yandex-captcha,
  data-show-comments-modal).
- События: send-comment:insales:ui_comments, error-comments:insales:ui_comments,
  show-modal-comments:insales:ui_comments.
- Условия: blog.comments_enabled?, comment.captcha_enabled?, blog.moderated?.

Полные примеры разметки — в references соответствующих скилов.
