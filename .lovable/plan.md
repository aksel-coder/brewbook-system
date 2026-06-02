# Coffee Zone — Sales & Inventory Management System

## Stack note (important)
Lovable runs on **TanStack Start (React 19) + Tailwind v4 + Lovable Cloud (Postgres, Auth, Storage, Server Functions)**. Node/Express/MySQL aren't supported here, but Lovable Cloud gives you the same capabilities (REST/RPC, JWT auth, relational DB, RLS). I'll deliver the full feature set on this stack. Charts via Recharts (already shadcn-compatible).

## Brand & Theme
- Coffee Brown `#6F4E37`, Cream `#F5F5DC`, Dark Green `#2E7D32` mapped to semantic tokens in `src/styles.css` (oklch).
- Uploaded Coffee Zone logo saved as a Lovable asset and used in sidebar + login.
- Sidebar layout (shadcn `Sidebar`) with topbar trigger; clean typography (Playfair Display for headings, Inter for body).

## Modules & Routes
- `/login` — username/password sign-in (email-based under the hood), error toast.
- `/_authenticated` layout (redirects unauth → `/login`) with sidebar.
  - `/` Dashboard — KPI cards (Total Sales, Total Products, Inventory on Hand, Low Stock count), Recent Transactions table, Best Sellers list, Sales trend (line) + Inventory by category (bar) using Recharts.
  - `/sales` — POS: product search, cart, qty +/-, auto totals (subtotal/tax/total), checkout → generates receipt #, printable receipt modal, auto inventory deduction.
  - `/sales/history` — past transactions with filters.
  - `/inventory` — list with low-stock badge, Add Stock / Adjust modals, movement history per product.
  - `/products` — CRUD products + categories, image upload to Lovable Cloud Storage.
  - `/reports` — Daily/Weekly/Monthly sales, Inventory, Best sellers, Low stock. Export **CSV** + **PDF** (jsPDF). (Excel = CSV-compatible; true .xlsx omitted to keep scope tight unless requested.)
  - `/users` — Admin only: list/create/edit/delete users, assign role (admin / cashier).

## Roles & Security
- Separate `user_roles` table + `has_role()` SECURITY DEFINER function (never store role on profiles).
- RLS on every table. Cashier: read products/inventory, create sales. Admin: full access + user management.
- Route guards in UI + RLS in DB (defense in depth).

## Database (Lovable Cloud / Postgres)
- `profiles(id, full_name, username, created_at)` — 1:1 with `auth.users`, auto-created via trigger.
- `app_role` enum (`admin`, `cashier`) + `user_roles(user_id, role)`.
- `categories(id, name)`.
- `products(id, category_id, name, price, cost, stock_quantity, image_url, description)`.
- `sales(id, receipt_number, user_id, subtotal, tax, total_amount, sale_date)`.
- `sale_items(id, sale_id, product_id, quantity, unit_price)`.
- `inventory_transactions(id, product_id, type[in/out/adjust], quantity, reference, created_at, created_by)`.
- DB trigger on `sale_items` insert → decrements `products.stock_quantity` + inserts `inventory_transactions` row (atomic, server-side — guarantees automatic deduction).
- Low-stock threshold column on `products` (default 10).
- All `GRANT`s + RLS policies in the migration.

## Server Functions (TanStack `createServerFn`)
Auth-protected via `requireSupabaseAuth`:
- `dashboard.getStats`, `dashboard.getSalesSummary`, `dashboard.getInventorySummary`
- `sales.create` (transactional: insert sale + items, returns receipt)
- `sales.list`, `sales.getById`
- `inventory.adjust`, `inventory.history`
- `products.list/create/update/delete`, `categories.*`
- `reports.sales(range)`, `reports.inventory()`, `reports.bestSellers()`, `reports.lowStock()`
- `users.list/create/update/delete` (admin-only middleware check)

## UI/UX
- Sidebar nav with logo; collapsible to icon rail.
- shadcn DataTable pattern (search, filter, pagination) for all lists.
- Toast notifications (sonner), confirmation `AlertDialog` for destructive actions, skeleton loaders.
- Fully responsive (mobile sidebar = sheet).
- Receipt component styled for print (`@media print`).

## Seed data
On first run, seed: 1 admin user (you'll set the password at signup), a few categories (Espresso, Brewed, Pastries, Merch) and ~8 sample products with stock, so the dashboard isn't empty.

## Out of scope (call out)
- Node/Express/MySQL backend (replaced by Lovable Cloud).
- True `.xlsx` export (CSV + PDF provided).
- Hardware receipt printer integration (uses browser print dialog).

Confirm and I'll build it.