# Roadmap

Each step gets its own plan and approval before work starts.

## 0. Safe copy running locally (current step)
Separate repo, no TRENDZ links, local Supabase in Docker, baseline schema, demo data, docs.

## 1. Business plan & pricing
- Research BookieBuddy's plans and other Indian rental-software competitors
- Unit economics: infra cost per shop vs price
- Pricing tiers (low or no setup fee, monthly/annual subscription)
- Switching pitch: free data migration from their current tool; TRENDZ as the reference customer

## 2. Multi-tenant conversion (the key technical step)
- `shops` table; `shop_id` on every business table; RLS: users only ever see their own shop
- Per-shop sequences for tokens (`BK-`, rental tokens) and per-shop settings
- Sign-up → create shop → onboarding wizard (branches, CSV import, invite staff)
- Done and tested locally first

## 3. Productisation
- Per-shop settings: name, logo, token prefix, time zone, WhatsApp templates, invoice/PDF layout
- Subscription billing (e.g. Razorpay Subscriptions), plan limits, trial
- Platform super-admin console (all shops, usage, billing status)
- Backups, monitoring, error tracking

## 4. Launch hosting
- New Overbooked accounts: Vercel (frontend) + Supabase (backend), separate from TRENDZ
- Staging + production environments; custom domain
- Pilot with 2–3 shops, then open sign-ups

## 5. Growth features
UI polish, customer history, reminders, reports, mobile/PWA, barcode labels, multi-language.

## On AWS / LocalStack
Not needed to launch. Vercel + Supabase can serve thousands of small shops at a low fixed cost.
LocalStack (a free local imitation of AWS) is a good way to *learn* AWS without risking a bill. Revisit
AWS only if costs or requirements at scale demand it.
