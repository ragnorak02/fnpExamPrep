# FNP Exam Prep App — Monetization + Mobile Release CLAUDE.md
Version: 2.0 (Subscription-Ready)
Owner: Nick
Primary Goal: Ship a real subscription-based iOS + Android app using RevenueCat + Supabase while preserving the current vanilla JS SPA as much as possible.
Target: Production-grade MVP with paywall, entitlement gating, and server-authoritative daily limits.

---

## 🧭 Mission

Transform the existing localStorage-first FNP study SPA into a paid subscription product with:

- Apple + Google subscriptions (RevenueCat)
- User identity + usage enforcement (Supabase)
- Daily question limits enforced server-side (free vs premium)
- Mobile distribution through Capacitor wrapper (no full rewrite required)

---

## ✅ Core Principles

- Move only money-critical state to server (entitlements + daily quota usage)
- Keep localStorage for offline UX and caching
- Server is source of truth for quota + tier
- No full framework rewrite for V1
- Deterministic phased execution

---

## 🚫 Non-Goals (V1 Guardrails)

- ❌ No Flutter rewrite
- ❌ No React Native rewrite
- ❌ No complex CMS
- ❌ No heavy sync features
- ❌ No custom payment processor outside Apple/Google

---

## 🧱 Tech Stack

Frontend:
- Existing Vanilla HTML/CSS/JS SPA

Mobile Wrapper:
- Capacitor

Subscriptions:
- RevenueCat

Backend:
- Supabase (Auth + Postgres + Edge Functions)

---

## 📁 Target Structure

```
fnpApp/
  index.html
  styles.css
  app.js
  data/
    questions.seed.json
    quotes.json
  mobile/
    capacitor.config.ts
    ios/
    android/
  backend/
    supabase/
      migrations/
      seed.sql
  docs/
    PRIVACY_POLICY.md
    TERMS.md
    RELEASE_CHECKLIST.md
  README.md
  CLAUDE.md
```

---

## 🔐 Security Rules

- Never store service role keys in client
- Server determines:
  - tier
  - daily quota
  - usage increments
- Client may cache but never enforce limits alone
- All premium gating must depend on server response

---

# DATABASE DESIGN (Supabase)

## profiles
- id (uuid, pk)
- created_at
- tier ('free' | 'premium')
- daily_quota (int)

## daily_usage
- id (uuid pk)
- user_id (uuid fk)
- day_iso (YYYY-MM-DD)
- used (int)
- updated_at

Unique constraint: (user_id, day_iso)

---

# API CONTRACT (Minimal Authority Layer)

GET /me
Returns:
{
  tier: "free",
  dailyQuota: 10,
  usedToday: 3,
  dayISO: "2026-03-01"
}

POST /usage/increment
Body:
{
  delta: 1
}

Returns:
{
  allowed: true,
  usedToday: 4,
  dailyQuota: 10
}

POST /entitlement/sync
Body:
{
  premiumActive: true
}

---

# EXECUTION PHASES

---

## 🔵 PHASE 1 — Baseline Lock

- [x] Document current behavior
- [x] Add appVersion constant
- [x] Add APP_ENV switch
- [x] Add debug info panel
- [ ] Confirm GitHub Pages stable

Exit: App stable and documented.

---

## 🔵 PHASE 2 — Supabase Setup

- [x] Create Supabase project *(manual — Nick creates at supabase.com)*
- [x] Enable Auth (email + password) *(on by default in Supabase)*
- [x] Create profiles table *(migration: 001_create_profiles.sql)*
- [x] Create daily_usage table *(migration: 002_create_daily_usage.sql)*
- [x] Enable RLS
- [x] Add user-only policies
- [x] Set default tier = free
- [x] Set default daily_quota = 10

Exit: Auth + DB working with RLS.

---

## 🔵 PHASE 3 — Authority Functions

- [x] Implement GET /me
- [x] Implement POST /usage/increment
- [x] Implement POST /entitlement/sync
- [x] Server computes dayISO
- [x] Prevent negative or excessive deltas

Exit: Server enforces quota reliably.

---

## 🔵 PHASE 4 — Auth Integration (Client)

- [ ] Add Supabase JS client
- [ ] Add Login UI
- [ ] Add Logout
- [ ] On startup call /me
- [ ] Store remote tier in state
- [ ] Display remaining quota

Exit: User login works and quota displays.

---

## 🔵 PHASE 5 — Quota Enforcement

- [ ] Before session start call /me
- [ ] Limit sessionCount to remaining
- [ ] On each answer call /usage/increment
- [ ] Stop session if allowed=false
- [ ] Display “Limit Reached” UI

Exit: Cannot exceed quota without server approval.

---

## 🔵 PHASE 6 — RevenueCat Setup

- [ ] Create RevenueCat project
- [ ] Create entitlement "premium"
- [ ] Add monthly product
- [ ] Add offering
- [ ] Record product IDs

Exit: RevenueCat configured.

---

## 🔵 PHASE 7 — Capacitor Wrapper

- [ ] Initialize Capacitor
- [ ] Add Android platform
- [ ] Add iOS platform
- [ ] Confirm app launches
- [ ] Configure deep links

Exit: Native builds launch successfully.

---

## 🔵 PHASE 8 — RevenueCat Mobile Integration

- [ ] Install RevenueCat SDK
- [ ] Initialize SDK with platform keys
- [ ] Implement purchase flow
- [ ] Implement restore purchases
- [ ] On entitlement change call /entitlement/sync
- [ ] Refresh /me after sync

Exit: Purchasing premium updates tier server-side.

---

## 🔵 PHASE 9 — Paywall UI

- [ ] Add Upgrade CTA
- [ ] Add Restore Purchases button
- [ ] Display feature comparison
- [ ] Link Privacy Policy
- [ ] Link Terms

Exit: Clear upgrade flow with compliance.

---

## 🔵 PHASE 10 — Cross-Device Behavior

- [ ] Require login for premium
- [ ] Ensure restore purchases works after reinstall
- [ ] Ensure /me reflects correct tier after login

Exit: Premium persists across devices.

---

## 🔵 PHASE 11 — Hardening

- [ ] Server sets dayISO
- [ ] Block increments if server unreachable
- [ ] Validate all delta inputs
- [ ] Confirm no secrets in client bundle

Exit: Basic anti-bypass protections active.

---

## 🔵 PHASE 12 — Store Preparation

- [ ] Create Privacy Policy
- [ ] Create Terms
- [ ] Prepare store screenshots
- [ ] Add support email
- [ ] Add delete account policy

Exit: Store-ready metadata prepared.

---

## 🔵 PHASE 13 — Testing Matrix

- [ ] Test free quota enforcement
- [ ] Test premium quota enforcement
- [ ] Test purchase
- [ ] Test restore
- [ ] Test cancellation
- [ ] Test reinstall
- [ ] Test offline behavior

Exit: All critical flows verified.

---

## 🔵 PHASE 14 — Launch

- [ ] Android internal testing
- [ ] Android production release
- [ ] TestFlight upload
- [ ] iOS App Review submission
- [ ] Monitor first subscription events

Exit: App live with subscriptions functional.

---

# FINAL VALIDATION CHECKLIST

- [ ] Quota cannot be exceeded
- [ ] Premium unlocks instantly
- [ ] Restore works
- [ ] Login stable
- [ ] Terms & Privacy linked
- [ ] No service keys exposed
- [ ] App handles offline safely

---

END OF FILE