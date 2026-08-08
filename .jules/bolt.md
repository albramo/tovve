# Bolt's Journal

## 2025-08-08 - Layout Thrashing in Sticky Add-To-Cart
**Learning:** Found a classic performance anti-pattern in `assets/sticky-add-to-cart.js` where a `window` scroll listener was querying `getBoundingClientRect()` on the main "Add to Cart" button on every single scroll frame, even though the component already set up a highly efficient `IntersectionObserver` for the same button. This caused forced synchronous layouts (layout thrashing) on scroll.
**Action:** Remove the scroll listener completely and cache the intersection state from `IntersectionObserver` as a private boolean (`#isTargetButtonIntersecting`). Use this cached state for any visibility checks, completely eliminating layout thrashing and improving scroll smoothness to a steady 60/120 FPS.
