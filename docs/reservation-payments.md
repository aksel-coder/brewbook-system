# Reservation payments setup

The reservation payment migration creates the private evidence bucket, payment tables, Admin-only verification RPC, and completion guard:

```powershell
supabase db push
```

If migrations are applied manually, run `supabase/migrations/20261013000000_reservation_payments.sql` against the project's Supabase database, then confirm it is recorded in the migration history before deploying the app.

Add the supplied GCash QR image at `public/images/gcash-qr.jpg`. The customer page intentionally reports the missing asset and does not substitute another QR image.

No new Vercel environment variable is introduced. Keep the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values configured for the app, and set `SUPABASE_SERVICE_ROLE_KEY` as a server-only Vercel environment variable for reservation creation and signed private-storage operations. Never expose or prefix the service-role key with `VITE_`.
