# Динамическая корзина: шаблон dynamic_basket

Полный исходник из документации. Паттерн применения — в SKILL.md: подписка на `update_items:insales:cart` → `Template.render(cart, "dynamic_basket")` → `InSalesUI.initAjaxInstance`.

```html
<div class="dynamic_basket js-dynamic_basket">
</div>

<script type="text/template" data-template-id="dynamic_basket">
  <div class="dynamic_basket-header">
    ваши покупки
  </div>
  <form action="/cart_items" method="post" data-ajax-cart>
    <input type="hidden" name="_method" value="put">
    <input type="hidden" name="make_order" value="">

    <div class="dynamic_basket-list">
      <% if(order_lines.length == 0){ %>
        <div class="dynamic_basket-empty text-center">
          Корзина пуста
        </div>
      <% } %>
      <% _.forEach(order_lines, function (value){ %>
        <div class="dynamic_item" data-item-id="<%= value.id %>" data-product-id="<%= value.product_id %>">
          <div class="row">
            <div class="cell-4">
              <a href="" class="dynamic_item-image">
                <span class="image-container is-square">
                  <img src="<%= value.first_image.medium_url %>">
                </span>
              </a>
            </div>
            <div class="cell-6">
              <div class="dynamic_item-title">
                <%= value.title %>
              </div>
              <div class="dynamic_item-quantity">
                <%= Shop.money.format(value.sale_price) %> х <%= value.quantity %>
              </div>

              <div data-quantity class="quantity is-basket">
                <div class="quantity-controls">
                  <button data-quantity-change="-1" class="quantity-control bttn-count" type="button">
                    -
                  </button>

                  <input class="quantity-input" type="text" name="cart[quantity][<%= value.id %>]" value="<%= value.quantity %>" />

                  <button data-quantity-change="1" class="quantity-control bttn-count" type="button">
                    +
                  </button>
                </div>
              </div>
            </div>
            <div class="cell-2 text-right">
              <button class="dynamic_item-del" data-item-delete="<%= value.id %>">
                &times;
              </button>
            </div>
          </div>
        </div>
      <% }) %>
    </div>

    <% if(order_lines.length > 0){ %>
      <div class="dynamic_basket-total row flex-middle">
        <div class="cell-6 row flex-center">
          итого
        </div>
        <div class="cell-6 row flex-center">
          <%= Shop.money.format(total_price) %>
        </div>
      </div>

      <input type="submit" value="оформить покупки" data-cart-submit class="dynamic_basket-submit bttn-prim">
    <% } %>
  </form>
</script>
```

Данные корзины в шаблоне: `order_lines[]` (`id`, `product_id`, `title`, `quantity`, `sale_price`, `first_image.medium_url`), `total_price`.

В этом примере форма несёт атрибут `data-ajax-cart`; в разделе «Корзина» той же документации корневой атрибут формы — `data-cart-form` (скил `insales-cart`). Для собственного кода сверяйте рабочий атрибут на живом шаблоне вашей темы.
