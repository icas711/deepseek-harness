# Форма отзыва к товару: полный пример

```liquid
{% if account.reviews_enabled? %}
<form
  data-reviews-form-wrapper='{
    "reviews_moderated": {{ account.reviews_moderated? }},
    "url": "{{ product.url }}"
  }'
  class="review-form"
  method="post"
  action="{{ product.url }}/reviews#review_form"
  enctype="multipart/form-data"
>
  {% assign success_message = messages.review_is_added %}
  {% if account.reviews_moderated? %}
    {% assign success_message = messages.review_is_added_moderated %}
  {% endif %}

  <div
    data-reviews-form-success='{
      "showTime": 10000,
      "message": "{{ success_message }}",
      "reloadPage": false
    }'
    class="notice-success"
  ></div>

  <div id="review_form" class="reviews-wrapper {% unless review.errors.size > 0 %}is-hide{% endunless %}">
    <div class="reviews-form">
      <div class="reviews-form__header">
        <div class="reviews-form__title">{{ messages.give_feedback }}</div>
      </div>

      <div class="reviews-form__content">
        <div class="form-field reviews-form__rating">
          <label class="form-field__label">{{ messages.field_rating }}
            <span class="text-error">*</span>
          </label>
          <div data-reviews-form-field-area class="star-rating-wrapper">
            <div class="star-rating">
              {% assign r = 5 %}
              {% for i in (1..5) %}
                <input
                  data-reviews-form-field
                  name="review[rating]"
                  id="star{{ r }}-{{ product.id }}"
                  type="radio"
                  name="reviewStars"
                  class="star-radio"
                  value="{{ r }}" />
                <label title="{{ r }}" for="star{{ r }}-{{ product.id }}" class="star-label icon icon-star"></label>
                {% assign r = r | minus: 1 %}
              {% endfor %}
            </div>
            <div data-reviews-form-field-error class="form__field-error"></div>
          </div>
        </div>

        <div class="grid-list grid-list_wide">
          <div
            data-reviews-form-field-area
            class="form-field is-required {% if review.errors contains 'author' %}is-error{% endif %}"
          >
            <label class="form-field__label">{{ messages.name }} <span class="text-error">*</span></label>
            <input
              data-reviews-form-field='{
                "isRequired": true,
                "errorMessage": "{{ messages.name_error | escape }}"
              }'
              name="review[author]"
              placeholder="{{ messages.name }}"
              value="{{ review.author }}"
              type="text"
              class="form-control form-control_size-m" />
            <div data-reviews-form-field-error class="form__field-error"></div>
          </div>

          <div data-reviews-form-field-area class="form-field is-required {% if review.errors contains 'email' %}is-error{% endif %}">
            <label class="form-field__label">{{ messages.field_email }} <span class="text-error">*</span></label>
            <input
              data-reviews-form-field='{
                "isRequired": true,
                "errorMessage": "{{ messages.email_error | escape}}"
              }'
              name="review[email]"
              placeholder="{{ messages.field_email }}"
              value="{{ review.email }}"
              type="text"
              class="form-control form-control_size-m"
            />
            <div data-reviews-form-field-error class="form__field-error"></div>
          </div>
        </div>

        <div
          data-reviews-form-field-area
          class="form-field form-comment is-required {% if review.errors contains 'content' %}is-error{% endif %}"
        >
          <label class="form-field__label">{{ messages.review }} <span class="text-error">*</span></label>
          <textarea
            data-reviews-form-field='{
              "isRequired": true,
              "errorMessage": "{{ messages.please_enter_message | escape }}"
            }'
            name="review[content]"
            placeholder="{{ messages.review }}"
            class="form-control form-control_size-m is-textarea"
          >{{ review.content }}</textarea>
          <div data-reviews-form-field-error class="form__field-error"></div>
        </div>

        {% if account.reviews_images_enabled? %}
          <div
            data-reviews-form-field-area
            class="form-field form-file is-required {% if review.errors contains 'image.image' %} input--error{% endif %}"
          >
            <label class="form-label icon icon-camera">
              <span class="load-review-image-name">{{ messages.add_photo }}</span>
              <input
                data-reviews-form-image
                type="file"
                class="js-load-review-image hidden"
                name="review[image_attributes][image]" />
            </label>
            <div data-reviews-form-field-error class="form__field-error"></div>
          </div>
        {% endif %}

        {% if review.captcha_enabled? %}
          <div
            data-reviews-form-field-area
            class="form-row form-field form-captcha {% if review.errors contains 'captcha_solution' %}is-error{% endif %}"
          >
            <div
              data-reviews-form-recaptcha='{
                "isRequired": true,
                "errorMessage": "{{ messages.recaptcha_error | escape }}"
              }'
              data-recaptcha-type="invisible"
              id="captcha_challenge"
              class="captcha-recaptcha"
            ></div>
            <div data-reviews-form-field-error class="form__field-error"></div>
          </div>
        {% endif %}

        <div class="form-field form-field_conctrols">
          <button type="submit" class="button button_wide">{{ messages.give_feedback }}</button>
        </div>
      </div>

      {% if account.reviews_moderated? %}
        <div class="reviews-form__moderation-info">
          {{ messages.reviews_are_moderated }}
        </div>
      {% endif %}
    </div>
  </div>
</form>
{% endif %}
```

## Кнопка модального окна

```liquid
<button data-show-reviews-modal='{"modal_id": "123456"}'>Форма отзыва</button>
```

```js
EventBus.subscribe('show-modal-reviews:insales:ui_reviews', (data) => {
  console.log(data);
});
```
