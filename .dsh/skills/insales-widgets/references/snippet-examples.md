# snippet.liquid: примеры из документации

## Адаптивная галерея с видео-блоками (splide + lazyload)

Настройки ширины с учётом флага «широкий контент»; блоки `data.blocks` перебираются дважды — слайдер и миниатюры:

```liquid
{% assign img_width = widget_settings.layout-content-max-width | default: settings.layout-content-max-width %}
{% if widget_settings.layout-wide-content %}
  {% assign img_width = 1920 %}
{% endif %}

<div class="banner-list__item {% unless widget_settings.banner-img-m %}show-mobile{% endunless %}">
  <div class="h4 heading">{{ widget_settings.title_text-default }}</div>
  <div class="gallery-contanier">
    <div class="splide gallery-splide">
      <div class="splide__slider">
        <div class="splide__track">
          <ul class="splide__list">
            {% assign slide_index = 0 %}
            {% for video in data.blocks %}
              <li class="splide__slide" data-slide-index="{{ slide_index }}">
                {% if video.link != blank %}
                  <div class="iframe_wrapper">
                    {{ video.link | video_iframe_by_url: id: video_id }}
                  </div>
                {% else %}
                  <div class="banner-list__empty-video">
                    {{ widget_settings.video-empty }}
                  </div>
                {% endif %}

                {% if video.image %}
                  <picture class="picture">
                    <source media="(min-width:769px)" data-srcset="{{ video.image | image_url: img_width, format: 'webp', resizing_type: 'fit_width' }}" type="image/webp" class="lazyload">
                    <source media="(max-width:480px)" data-srcset="{{ video.image | image_url: 500, format: 'webp', resizing_type: 'fit_width' }}" type="image/webp" class="lazyload">
                    <source media="(max-width:768px)" data-srcset="{{ video.image | image_url: 768, format: 'webp', resizing_type: 'fit_width' }}" type="image/webp" class="lazyload">
                    <img data-src="{{ video.image | image_url: 940, resizing_type: 'fit_width' }}" class="lazyload">
                  </picture>
                {% else %}
                  <img class="picture" src="{{ video.link | video_preview_by_url }}" style="max-width: 100%" />
                {% endif %}
                <a href="" class="button banner-preview__play-btn">
                  <div class="triangle right"></div>
                </a>
              </li>
              {% assign slide_index = slide_index | plus: 1 %}
            {% endfor %}
          </ul>
        </div>
      </div>
    </div>
  </div>
  <div class="thumbnails-contanier js-init">
    <div class="splide thumbnails-splide">
      <div class="splide__track">
        <ul class="splide__list">
          {% for video in data.blocks %}
            <li class="splide__slide">
              {% if video.image %}
                <picture>
                  <source media="(min-width:769px)" data-srcset="{{ video.image | image_url: img_width, format: 'webp', resizing_type: 'fit_width' }}" type="image/webp" class="lazyload">
                  <source media="(max-width:480px)" data-srcset="{{ video.image | image_url: 500, format: 'webp', resizing_type: 'fit_width' }}" type="image/webp" class="lazyload">
                  <img data-src="{{ video.image | image_url: 940, resizing_type: 'fit_width' }}" class="lazyload">
                </picture>
              {% else %}
                <img class="picture" src="{{ video.link | video_preview_by_url }}" style="max-width: 100%" />
              {% endif %}
            </li>
          {% endfor %}
        </ul>
      </div>
    </div>
  </div>
</div>
```

## Отладка переменных

```liquid
{% help %}          {# доступные переменные текущей страницы #}
{% help account %}  {# свойства объекта account #}
```

## snippet.js: реакция на смену варианта товара

Пример подписки на событие common.v2.js внутри виджета (замена фото в модальном превью):

```js
EventBus.subscribe('change_variant:insales:product', function(data) {
  let is_product_instance_in_modal_panel = !!$(data.action.product[0]).parents(".modal-product-preview.is-open").length;

  if (data.action && data.action.product && data.first_image.url && is_product_instance_in_modal_panel) {
    let product_node = $(data.action.product[0]);
    product_node.find(".product-preview__photo img").attr("src", data.first_image.medium_url);
  }
});
```

## snippet.js: lazyload по всем копиям виджета

```js
$widget.each(function(index, el) {
  new LazyLoad({
    container: $(el).get(0),
    elements_selector: '.lazyload'
  });
});
```
