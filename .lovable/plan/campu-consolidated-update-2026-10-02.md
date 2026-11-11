# Campu consolidated update

## Goal
Upgrade the shopper experience and admin tools in the requested priority order while preserving Campu’s existing pink/purple brand and every current admin order view.

## Implementation order

1. **Home, categories, banners, and navigation**
   - Add a public banner record model with admin-only writes and public reads.
   - Create a dedicated image bucket for banner and product media, with public viewing and admin-only upload/update/delete rules.
   - Add Banner Management inside Admin Settings: multi-image upload, list, ordering, and removal.
   - Build a reusable home banner carousel that loads all active banners, advances every three seconds, loops, supports manual dots/swiping, and respects reduced-motion preferences.
   - Restructure Home and Categories around compact search, horizontally scrolling category pills, and the existing two-column product grid.
   - Restyle the fixed bottom navigation as a floating rounded bar with soft shadows, without changing routes or swipe navigation.

2. **Inventory and product photos**
   - Replace the image URL field with direct image upload.
   - Make Add/Edit Product expose exactly Product Name, Description, Category, Price, and Stock Quantity, plus the required photo picker.
   - Support editing every listed field and deleting products; preserve stock toggles and low-stock warnings.
   - Remove newly uploaded files if saving the matching product fails, avoiding orphaned media.

3. **Product-detail cart quantity**
   - Keep the selected local quantity as the amount passed to the global cart in one action.
   - Cap quantities to available stock and verify the header badge and floating cart summary update immediately.

4. **Additional order categories**
   - Preserve Payments, Orders, Active, Completed, and Cancelled views.
   - Add Pending Orders for `pending` and `payment_review` orders.
   - Keep Active Orders focused on `accepted` and `out_for_delivery` orders, with existing OTP delivery and refund flows unchanged.

## Technical details
- Use the existing browser database client so row-level access rules remain authoritative.
- Banner records store storage object paths and display order; the public carousel resolves public media URLs.
- Product `image_url` continues to hold a displayable URL, preserving current product cards, cart snapshots, and order history.
- Add accessible labels, stable image aspect ratios, mobile overflow handling, loading/empty/error states, and route-specific social metadata where currently incomplete.
- Record the new shared media/storage architecture in `AGENTS.md` and update the roadmap as each priority completes.

## Validation
- Confirm database migration and generated types succeed.
- Verify admin banner upload/removal and product create/edit/photo upload using an authenticated admin session.
- Verify Home carousel loops, category pills filter/navigate correctly, Categories filters products, and bottom navigation fits mobile and desktop widths.
- Verify product-detail quantity updates both cart indicators immediately.
- Verify all existing and new order tabs contain the correct statuses and OTP/refund actions still work.
- Check current preview build diagnostics and run focused browser checks at 1280px and mobile widths.
