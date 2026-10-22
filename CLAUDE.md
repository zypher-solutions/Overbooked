# TRENDZ Rental Management System
Client project, handover Fri 16 Oct 2026. Goal: find and fix bugs. No refactors.

## Stack
Python backend, TypeScript frontend, Supabase (BaaS). Windows 11.
Branches: main (production), development. Work only on qa/testing.

## Business model (Indian rental business, negotiated deals)
- Multiple products, each with its own price. Products can be added anytime.
- Price, security deposit and late fee are NOT fixed. They are negotiated
  per rental. So there are no fixed expected values: test CONSISTENCY, not constants.
- Invariants to verify: total = items - discounts; balance due = total - payments
  and never negative; refund <= deposit paid; no overlapping bookings for the same
  item; return date >= start date; no negative amounts; dashboard figures equal
  the underlying records.

## Rules
- Plan mode first. Propose changes, wait for my approval before editing any file.
- Never read or print .env files or keys.
- No new dependencies, no architecture changes before handover.
- If a business rule is unclear, list your assumption in QA_REPORT.md and ask me.

## Output
QA_REPORT.md: findings ranked critical/high/medium/low, each with file, line,
how to reproduce, and suggested fix.