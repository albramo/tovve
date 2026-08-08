import { Component } from '@theme/component';
import { ThemeEvents, QuantitySelectorUpdateEvent } from '@theme/events';
import { morph } from '@theme/morph';
import { onAnimationEnd } from '@theme/utilities';
import { StandardEvents, ProductSelectEvent, CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

/**
 * @typedef {Object} ProductVariant
 * @property {string|number} [id] - Variant ID
 * @property {string} [title] - Variant title
 * @property {string} [name] - Variant name
 * @property {boolean} [available] - Whether variant is available
 * @property {Object} [featured_media] - Featured media object
 * @property {Object} [featured_media.preview_image] - Preview image data
 * @property {string} [featured_media.preview_image.src] - Image source URL
 * @property {string} [featured_media.alt] - Alt text for the image
 */

/**
 * @typedef {HTMLElement & {
 *   source: Element,
 *   destination: Element,
 *   useSourceSize: string | boolean
 * }} FlyToCart
 */

/**
 * @typedef {Object} StickyAddToCartRefs
 * @property {HTMLElement} stickyBar - The floating bar container
 * @property {HTMLButtonElement} addToCartButton - Sticky bar's button
 * @property {HTMLElement} quantityDisplay - Quantity display container
 * @property {HTMLElement} quantityNumber - Quantity number element
 * @property {HTMLImageElement} productImage - Product image element
 */

/**
 * A custom element that manages a sticky add-to-cart bar.
 * Shows when the main buy buttons scroll out of view.
 *
 * @extends {Component<StickyAddToCartRefs>}
 */
class StickyAddToCartComponent extends Component {
  requiredRefs = ['stickyBar', 'addToCartButton', 'quantityDisplay', 'quantityNumber'];

  /** @type {IntersectionObserver | null} */
  #buyButtonsIntersectionObserver = null;

  /** @type {IntersectionObserver | null} */
  #mainBottomObserver = null;

  /** @type {number | undefined} */
  #resetTimeout;

  /** @type {boolean} */
  #isStuck = false;

  /** @type {number | null} */
  #animationTimeout = null;

  /** @type {AbortController} */
  #abortController = new AbortController();

  /** @type {HTMLButtonElement | null} */
  #targetAddToCartButton = null;

  /** @type {number} */
  #currentQuantity = 1;

  /** @type {boolean} */
  #hiddenByBottom = false;

  /** @type {boolean} Track if the target button is visible in the viewport using IntersectionObserver */
  #isTargetButtonIntersecting = true;

  /** @type {number | null} requestAnimationFrame handle for throttled scroll check */
  #scrollRafId = null;

  connectedCallback() {
    super.connectedCallback();

    this.#setupIntersectionObserver();

    const { signal } = this.#abortController;
    window.addEventListener('scroll', this.#handleScroll, { passive: true, signal });

    const target = this.closest('.shopify-section');
    target?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect, { signal });

    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartAddComplete, { signal });
    document.addEventListener(StandardEvents.cartError, this.#handleCartAddComplete, { signal });
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#handleQuantityUpdate, { signal });

    this.#getInitialQuantity();
    this.#showStickyBar();

    customElements.whenDefined('shopify-chat').then(() => {
      if (signal.aborted) return;
      if (this.#isStuck && this.#isChatActive()) this.#hideStickyBar();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#buyButtonsIntersectionObserver?.disconnect();
    this.#mainBottomObserver?.disconnect();
    this.#abortController.abort();
    if (this.#animationTimeout) {
      clearTimeout(this.#animationTimeout);
    }
    if (this.#scrollRafId !== null) {
      cancelAnimationFrame(this.#scrollRafId);
    }
  }

  #handleScroll = () => {
    if (this.#scrollRafId !== null) return;

    this.#scrollRafId = requestAnimationFrame(() => {
      this.#scrollRafId = null;
      this.#updateStickyBarState();
    });
  };

  #updateStickyBarState() {
    // Retry finding and observing the target button if it was missing initially (lazy initialization check)
    if (!this.#targetAddToCartButton) {
      this.#setupIntersectionObserver();
    }

    if (this.#isCartDrawerOpen() || this.#isTargetButtonVisible()) {
      this.#hideStickyBar();
    } else {
      this.#showStickyBar();
    }
  }

  /**
   * Sets up the IntersectionObserver to watch the buy buttons visibility.
   * This is defined as a reusable class method to avoid runtime errors on variant change.
   */
  #setupIntersectionObserver() {
    const productForm = this.#getProductForm();
    if (productForm) {
      this.#targetAddToCartButton = productForm.querySelector('[ref="addToCartButton"]') || productForm.querySelector('button[name="add"]') || productForm.querySelector('.add-to-cart-button');
    }
    if (!this.#targetAddToCartButton) {
      this.#targetAddToCartButton = document.querySelector('.product-details [ref="addToCartButton"]') || document.querySelector('.product-details button[name="add"]');
    }

    this.#buyButtonsIntersectionObserver?.disconnect();

    if (this.#targetAddToCartButton) {
      this.#buyButtonsIntersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          this.#isTargetButtonIntersecting = entry.isIntersecting;
          if (entry.isIntersecting || this.#isCartDrawerOpen()) {
            this.#hideStickyBar();
          } else {
            this.#showStickyBar();
          }
        });
      }, {
        root: null,
        threshold: 0
      });
      this.#buyButtonsIntersectionObserver.observe(this.#targetAddToCartButton);
    } else {
      this.#hideStickyBar();
    }

    // Observe cart drawer attribute changes
    this.#observeCartDrawer();
  }

  #observeCartDrawer() {
    const cartDrawer = document.querySelector('theme-drawer#cart-drawer');
    if (!cartDrawer) return;

    if (this._drawerObserver) this._drawerObserver.disconnect();
    this._drawerObserver = new MutationObserver(() => {
      if (this.#isCartDrawerOpen()) {
        this.#hideStickyBar();
      } else {
        this.#handleScroll();
      }
    });
    this._drawerObserver.observe(cartDrawer, { attributes: true, attributeFilter: ['open'] });
  }

  #isCartDrawerOpen() {
    const drawer = document.querySelector('theme-drawer#cart-drawer');
    if (!drawer) return false;
    return drawer.hasAttribute('open') || drawer.open === true || drawer.classList.contains('is-open');
  }

  #isTargetButtonVisible() {
    if (!this.#targetAddToCartButton) return false;
    return this.#isTargetButtonIntersecting;
  }

  // Public action handlers
  /**
   * Handles the add to cart button click in the sticky bar
   */
  handleAddToCartClick = async () => {
    if (!this.#targetAddToCartButton) return;
    this.#targetAddToCartButton.dataset.puppet = 'true';
    this.#targetAddToCartButton.click();
    const cartIcon = document.querySelector('.header-actions__cart-icon');

    if (this.refs.addToCartButton.dataset.added !== 'true') {
      this.refs.addToCartButton.dataset.added = 'true';
    }

    if (this.#resetTimeout) clearTimeout(this.#resetTimeout);

    await onAnimationEnd([this.refs.addToCartButton]);
    this.#resetTimeout = setTimeout(() => {
      this.refs.addToCartButton.removeAttribute('data-added');
    }, 800);
  };

  /**
   * Handles product select events (variant selected and updated)
   * @param {ProductSelectEvent} event - The product select event
   */
  #handleProductSelect = (event) => {
    if (!(event.target instanceof Element) || event.target.closest('product-card')) return;

    // Update variant ID from the event detail (variant:selected part)
    const { optionValueId } = event.detail ?? {};
    if (optionValueId) {
      this.dataset.currentVariantId = optionValueId;
    }

    // Wait for the promise to resolve with variant update data
    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html, productId, resource: variant } = detail;

        if (productId && productId !== this.dataset.productId) return;

        // Get the new sticky add to cart HTML from the server response
        const newStickyAddToCart = /** @type {HTMLElement | null} */ (html.querySelector('sticky-add-to-cart'));
        if (!newStickyAddToCart) return;

        const newStickyBar = newStickyAddToCart.querySelector('[ref="stickyBar"]');
        if (!newStickyBar) return;

        // Store current visibility state before morphing
        const currentStuck = this.refs.stickyBar.getAttribute('data-stuck') || 'false';
        const variantAvailable = newStickyAddToCart.dataset.variantAvailable;

        // Morph the entire sticky bar content
        morph(this.refs.stickyBar, newStickyBar, { childrenOnly: true });

        // Restore visibility state after morphing
        this.refs.stickyBar.setAttribute('data-stuck', currentStuck);
        this.dataset.variantAvailable = variantAvailable;

        // Update the dataset attributes with new variant info
        if (variant && variant.id) {
          this.dataset.currentVariantId = variant.id;
        }

        // Re-cache the target add to cart button after morphing
        const productForm = this.#getProductForm();
        if (productForm) {
          this.#targetAddToCartButton = productForm.querySelector('[ref="addToCartButton"]');
        }

        if (variant == null) {
          this.#handleVariantUnavailable();
        }
        // Restore the current quantity display if needed
        this.#updateButtonText();

        // Re-initialize intersection observer for the new variant button
        this.#setupIntersectionObserver();
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[sticky-add-to-cart] Event promise rejected:', error);
      });
  };

  /**
   * Updates the variant title based on selected options when the variant is unavailable
   */
  #handleVariantUnavailable = () => {
    this.dataset.currentVariantId = '';
    const variantTitleElement = this.querySelector('.sticky-add-to-cart__variant');
    const productId = this.dataset.productId;
    const variantPicker = document.querySelector(`variant-picker[data-product-id="${productId}"]`);
    if (!variantTitleElement || !variantPicker) return;

    const selectedOptions = Array.from(variantPicker.querySelectorAll('input:checked'))
      .map((option) => /** @type {HTMLInputElement} */ (option).value)
      .filter((value) => value !== '')
      .join(' / ');
    if (!selectedOptions) return;
    variantTitleElement.textContent = selectedOptions;
  };

  /**
   * Handles cart add complete (success or error) - resets puppet flag
   * @param {CartLinesUpdateEvent | CartErrorEvent} event - The cart event
   */
  #handleCartAddComplete = (event) => {
    // Reset the puppet flag only after the cart operation's promise settles,
    // not when the event is first dispatched (before the HTTP request completes).
    const resetPuppet = () => {
      if (this.#targetAddToCartButton) {
        this.#targetAddToCartButton.dataset.puppet = 'false';
      }
    };

    // CartLinesUpdateEvent has a promise; CartErrorEvent does not (error already happened).
    if ('promise' in event && event.promise instanceof Promise) {
      event.promise.finally(resetPuppet);
    } else {
      resetPuppet();
    }
  };

  /**
   * Handles quantity selector update events
   * @param {QuantitySelectorUpdateEvent} event - The quantity update event
   */
  #handleQuantityUpdate = (event) => {
    // Only respond to product page quantity selector updates, not cart drawer
    if (event.detail.cartLine) return;

    this.#currentQuantity = event.detail.quantity;
    this.#updateButtonText();

    // Sync all quantity inputs on the product page
    const sectionElement = this.closest('.shopify-section');
    if (sectionElement) {
      const quantityInputs = sectionElement.querySelectorAll('quantity-selector-component input[name="quantity"]');
      quantityInputs.forEach(input => {
        if (parseInt(input.value) !== this.#currentQuantity) {
          input.value = this.#currentQuantity;
          const component = input.closest('quantity-selector-component');
          if (component && typeof component.updateButtonStates === 'function') {
            component.updateButtonStates();
          }
        }
      });
    }
  };

  /**
   * Shows the sticky bar with animation
   */
  #showStickyBar() {
    if (this.#isCartDrawerOpen() || this.#isChatActive() || this.#isTargetButtonVisible()) {
      this.#hideStickyBar();
      return;
    }
    const stickyBar = this.refs?.stickyBar || this.querySelector('.sticky-add-to-cart__bar');
    if (!stickyBar) return;
    this.#isStuck = true;
    stickyBar.dataset.stuck = 'true';
  }

  #hideStickyBar() {
    const stickyBar = this.refs?.stickyBar || this.querySelector('.sticky-add-to-cart__bar');
    if (!stickyBar) return;
    this.#isStuck = false;
    stickyBar.dataset.stuck = 'false';
  }

  // Helper methods
  /**
   * Checks whether the Shopify Chat is active on the page.
   * When active, the sticky bar must stay hidden to avoid overlapping the chat UI.
   * Defined as a private method in the class body.
   *
   * <shopify-chat> is rendered unconditionally by chat-drawer.liquid, but
   * the "Ask anything" button only paints once the Inbox app has installed
   * and upgraded the element. Gate on the registration of the custom element
   * (the same signal chat-drawer.liquid uses via customElements.whenDefined)
   * so the inert placeholder on shops without Inbox doesn't suppress the
   * sticky bar.
   *
   * @returns {boolean}
   */
  #isChatActive() {
    const chat = document.querySelector('shopify-chat');
    if (!chat) return false;
    const drawer = document.querySelector('#chat-drawer');
    return chat.hasAttribute('open') || Boolean(drawer && drawer.hasAttribute('open'));
  }

  /**
   * Gets the product form element
   * @returns {HTMLElement | null}
   */
  #getProductForm() {
    const productId = this.dataset.productId;
    const sectionElement = this.closest('.shopify-section');
    if (sectionElement && productId) {
      const sectionId = sectionElement.id.replace('shopify-section-', '');
      const form = document.querySelector(
        `#shopify-section-${sectionId} product-form-component[data-product-id="${productId}"]`
      );
      if (form) return form;
    }
    return document.querySelector('product-form-component[data-product-id]') || document.querySelector('product-form-component') || document.querySelector('.product-details');
  }

  /**
   * Gets the initial quantity from the data attribute
   */
  #getInitialQuantity() {
    this.#currentQuantity = parseInt(this.dataset.initialQuantity || '1') || 1;
    this.#updateButtonText();
  }

  /**
   * Updates the button text to include quantity
   */
  #updateButtonText() {
    const { addToCartButton, quantityDisplay, quantityNumber } = this.refs;

    const available = !addToCartButton.disabled;

    // Update the quantity number
    quantityNumber.textContent = this.#currentQuantity.toString();

    // Show/hide the quantity display based on availability and quantity
    if (available && this.#currentQuantity > 1) {
      quantityDisplay.style.display = 'inline';
    } else {
      quantityDisplay.style.display = 'none';
    }
  }
}

if (!customElements.get('sticky-add-to-cart')) {
  customElements.define('sticky-add-to-cart', StickyAddToCartComponent);
}
