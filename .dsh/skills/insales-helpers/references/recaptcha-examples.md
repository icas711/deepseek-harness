# reCaptcha в кастомных формах: рабочие примеры

## reCaptcha v2

```html
<form id="myCustomForm" method="post">
  <div>
    <label for="name">Имя:</label>
    <input type="text" id="name" name="feedback[name]" placeholder="Имя">
  </div>
  <div>
    <label for="email">Email:</label>
    <input type="email" id="email" name="feedback[from]" placeholder="Email">
  </div>
  <div>
    <label for="phone">Телефон:</label>
    <input type="tel" id="phone" name="feedback[phone]" placeholder="Номер телефона">
  </div>
  <div>
    <label for="subject">Тема:</label>
    <input type="text" id="subject" name="feedback[subject]" placeholder="Обратная связь">
  </div>
  <div>
    <label for="content">Сообщение:</label>
    <textarea id="content" name="feedback[content]" placeholder="Сообщение"></textarea>
  </div>

  <!-- Контейнер для ReCaptcha (обязан быть пустым) -->
  <div id="recaptchaBlock"></div>

  <button type="submit">Отправить</button>
</form>
```

```js
$(function() {
  // После загрузки страницы выполняем рендер виджета ReCaptcha
  reCaptchaCommon.render(document.querySelector('#recaptchaBlock'), 'feedback')

  // Обработчик отправки формы
  $(document).on('submit', '#myCustomForm', function(e) {
    e.preventDefault();
    const $form = $(this);
    const formData = new FormData($form.get(0));

    const feedback = {
      lang: "{{ language.locale }}",
      "feedback[name]": formData.get('feedback[name]'),
      "feedback[from]": formData.get('feedback[from]'),
      "feedback[phone]": formData.get('feedback[phone]'),
      "feedback[subject]": formData.get('feedback[subject]'),
      "feedback[content]": formData.get('feedback[content]') || 'Без сообщения',
      // После верификации ReCaptcha сама создаст поле g-recaptcha-response
      'g-recaptcha-response': formData.get('g-recaptcha-response'),
    }

    // CSRF-токен
    const csrfTokenElement = document.querySelector("meta[name='csrf-token']");
    if (csrfTokenElement) {
      $.ajaxSetup({ headers: { 'X-CSRF-Token': csrfTokenElement.content } });
    } else {
      console.error('CSRF token meta tag not found. AJAX requests may fail.');
    }

    $.post('/client_account/feedback.json', feedback)
      .done(function (done) { console.log(done); });
  })
});
```

## reCaptcha v3 Invisible

Разметка — контейнер с `data-recaptcha-type="invisible"` и скрытое поле типа капчи:

```html
<div id="recaptchaBlock" data-recaptcha-type="invisible"></div>
<input type="hidden" name="recaptcha_type" value="invisible">
```

JS: при `null` от `executeInvisible` отправка отменяется — форма уйдёт повторно из callback после верификации:

```js
$(function() {
  reCaptchaCommon.render(document.querySelector('#recaptchaBlock'), 'feedback')

  $(document).on('submit', '#myCustomForm', function(e) {
    e.preventDefault();
    sendFeedbackForm(this);
  })

  function sendFeedbackForm(form) {
    const recaptchaResponse = reCaptchaCommon.executeInvisible(form, sendFeedbackForm, 'feedback');
    if (!recaptchaResponse) { return }

    const formData = new FormData(form);

    const feedback = {
      lang: "{{ language.locale }}",
      "feedback[name]": formData.get('feedback[name]'),
      "feedback[from]": formData.get('feedback[from]'),
      "feedback[phone]": formData.get('feedback[phone]'),
      "feedback[subject]": formData.get('feedback[subject]'),
      "feedback[content]": formData.get('feedback[content]') || 'Без сообщения',
      'g-recaptcha-response': formData.get('g-recaptcha-response'),
      'recaptcha_type': formData.get('recaptcha_type')
    }

    const csrfTokenElement = document.querySelector("meta[name='csrf-token']");
    if (csrfTokenElement) {
      $.ajaxSetup({ headers: { 'X-CSRF-Token': csrfTokenElement.content } });
    } else {
      console.error('CSRF token meta tag not found. AJAX requests may fail.');
    }

    $.post('/client_account/feedback.json', feedback)
      .done(function (done) { console.log(done); });
  }
});
```

Позиция бейджа v3: `data-badge` на контейнере — `inline` | `bottomleft` (по умолчанию) | `bottomright`.
