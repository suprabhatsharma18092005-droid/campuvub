# Campu catalog and admin updates

## What will change
- Tighten the two-mode selector title on mobile while keeping the existing side-by-side selector and mode behavior.
- Redesign the shared product card so home, search, category, and similar-item lists use one consistent compact layout.
- Replace category chips with image-led four-column category grids on home and the Categories page.
- Extend the product editor with MRP, optional tag, specs, and tagline; extend category management with an image URL.
- Split Admin Orders into Quick and Sunday/Tuesday sections, retain status sub-tabs, and clearly highlight scheduled orders and their date.

## Data changes
Add nullable fields to products for actual price, tag, specs, and tagline, plus a nullable image URL on categories. Existing `price` remains the selling price, and existing product/category data remains valid.

## Preserve
Delivery-mode filtering, cart selection/mode isolation, checkout validation and payment/order workflows remain unchanged.

## Verification
Run the existing delivery/order tests plus a small price-display rule test, then check the preview build and exercise the public category/product views.
