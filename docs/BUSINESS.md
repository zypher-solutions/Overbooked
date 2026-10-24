# Business notes

Working notes. The full plan (competitor research, pricing, pitch) is roadmap step 1.

## How software companies sell this cheaply
1. **Multi-tenancy.** One app and one database serve hundreds of shops. Every row carries a `shop_id`
   and Row Level Security keeps shops apart. Shop #200 costs almost nothing extra.
2. **Fixed cost spread over many customers.** Example: ~₹2,500/month of infrastructure shared by 100
   shops is ~₹25 per shop. At ₹999/month the gross margin is above 95%.
3. **Self-serve.** Sign up, pick a plan, import products from CSV, invite staff. Onboarding takes no
   developer time.
4. **Configuration, not custom code.** "Made for you" means settings every shop can switch on (branding,
   prefixes, fields, templates). A code fork per client destroys the margin and the ability to ship fixes.
5. **Recurring revenue.** A small monthly fee, a discount for annual prepay, and low churn because
   switching is painful.
6. **Free / cheap entry tiers are marketing.** They only work because of 1–4.

## Implications for Overbooked
- Multi-tenancy and self-serve onboarding come before scale or AWS.
- Sell customisation as paid *configuration/setup* or as paid features that every shop can use.
- Offer free migration from the competitor tool to remove the "we already paid" objection.
- TRENDZ is the case study: real shop, real branches, real money flowing through the ledger.

## Open questions
- BookieBuddy plan details and prices (to research)
- Target segment first: bridal/costume rental, sports equipment, both?
- One-time setup fee or none?
- Support model (WhatsApp support hours, onboarding call)
