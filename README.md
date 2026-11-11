# Campus Courier

Product Requirements Document (PRD) - Campu V2

Project Name: Campu V2 (Exclusive Campus Delivery App)

Objective: Ek ultra-fast, real-time delivery platform develop karna jisme seamless UI navigation, differential payment system (UPI/COD), aur robust FCM push notifications integrated hon.

1. Tech Stack & Core Integrations

 * Frontend UI: React / React Native (Optimized for Lovable AI) with Stack Router.

 * Backend & DB: Supabase (PostgreSQL, Real-time WebSockets, Edge Functions).

 * Authentication: Supabase Auth (Google OAuth 2.0 + Email fallback).

 * Notifications: Firebase Cloud Messaging (FCM) API.

2. UI/UX & Navigation Architecture

 * Stack Navigation (The Infinite Loop): Product cards par tap karne se detailed view open hoga. Niche "Similar Items" dikhenge. Naye item par tap karne se naya page stack par aayega. Back button dabane par pages reverse order mein sequentially close honge.

 * Swipeable Pages: Main tabs (Home, Categories, Profile) ke beech horizontal swipe navigation.

 * Micro-interactions: Add to cart par floating icon bounce effect; Live inventory sync (Out-of-stock items real-time mein grey out honge).

3. Student App (Customer Flow)

 * Strict Profile Setup: Login ke baad first order place karne se pehle Phone Number, Hostel Block, aur Room Number fill karna REQUIRED hai. Iske bina app aage proceed nahi karega.

 * Differential Checkout System:

   * UPI (Recommended): Delivery Fee = ₹5.

   * COD: Delivery Fee = ₹8 (Includes warning: Extra handling charge).

 * UPI Payment & UTR Flow:

   * UPI select karne par Admin ka official QR Code aur UPI ID (with copy button) display hoga.

   * Ek input field aayega: "Enter 12-digit UTR/Reference No."

   * Rule: UTR field is STRICTLY REQUIRED if UPI is selected. Checkout button disabled rahega jab tak valid 12-digit UTR enter na ho.

 * Real-Time Status Tracker:

   * Order Timeline: Placed -> Payment Under Review (Spinner animation) -> Accepted -> Out for Delivery -> Delivered.

4. Admin & Vendor Dashboard

 * Live Order Radar: Auto-refreshing dashboard with loud notification sound alerts for new incoming orders.

 * Payment Verification Queue: UPI orders specifically highlight honge. Order card par prominently UTR Number dikhega.

   * Action 1: Verify & Accept (Status changes to Accepted, Student gets notification).

   * Action 2: Reject Payment (Status changes to Cancelled, Student gets alert for invalid UTR).

 * Broadcast Center: Admin can type a message (Title, Body) and hit "Send to All" to fire FCM notifications to all students for flash sales/offers.

 * Quick Inventory: 1-click toggle to mark items "Out of Stock" affecting student screens instantly.

5. Database Schema (Supabase)

Table: profiles

 * id (UUID, Primary Key)

 * full_name (Text)

 * phone_number (Text, REQUIRED)

 * hostel_details (Text, REQUIRED)

 * fcm_token (Text)

 * role (Enum: student, vendor, admin)

Table: products

 * id (UUID, Primary Key)

 * name (Text, REQUIRED)

 * price (Numeric, REQUIRED)

 * image_url (Text)

 * in_stock (Boolean, Default: True)

Table: orders

 * id (UUID, Primary Key)

 * student_id (UUID, Foreign Key)

 * cart_items (JSONB, REQUIRED)

 * payment_method (Enum: UPI, COD, REQUIRED)

 * utr_number (Text, REQUIRED IF UPI)

 * delivery_fee (Numeric, REQUIRED)

 * status (Enum: pending, payment_review, accepted, out_for_delivery, delivered, cancelled)

6. Notification & Real-Time Logic

 * Realtime Subscriptions: Supabase WebSockets listen to changes in orders and products tables. Admin hitting "Verify & Accept" instantly changes the user's screen from "Review" to "Accepted".

 * Edge Functions: Trigger FCM API. Automatically send push notification to Admin on new order, and to Student when order status changes.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://campuu.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/02e187fb-e828-41d3-bb22-e06867d81854).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
