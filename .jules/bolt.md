# Bolt's Journal

## 2025-08-08 - Layout Thrashing in Sticky Add-To-Cart
**Learning:** Found a classic performance anti-pattern in `assets/sticky-add-to-cart.js` where a `window` scroll listener was querying `getBoundingClientRect()` on the main "Add to Cart" button on every single scroll frame, even though the component already set up a highly efficient `IntersectionObserver` for the same button. This caused forced synchronous layouts (layout thrashing) on scroll.
**Action:** Remove the scroll listener completely and cache the intersection state from `IntersectionObserver` as a private boolean (`#isTargetButtonIntersecting`). Use this cached state for any visibility checks, completely eliminating layout thrashing and improving scroll smoothness to a steady 60/120 FPS.

## 2025-08-08 - Forced Reflow in Product Media Gallery Transition
**Learning:** Found a layout thrashing anti-pattern in the product media gallery (`snippets/product-media-gallery-content.liquid`) where `next.getBoundingClientRect()` was synchronously called on thumbnail clicks to trigger a CSS transition reflow. This caused a forced synchronous reflow on every media thumbnail change, degrading page responsiveness and raising Lighthouse audits.
**Action:** Replace `next.getBoundingClientRect()` with a high-performance double `requestAnimationFrame` pattern. This schedules state changes across frame paint boundaries natively, allowing the browser to transition the element smoothly without forcing synchronous layout recalculations.
