---
name: cost-guardrails-review-2026-09
description: 2026-09-24 security review of notification cost guardrails (short links, OTP global cap, notify caps) — open trade-offs to re-check in later reviews
metadata:
  type: project
---

2026-09-24 review of the "notification cost guardrails" change found no CRITICAL. Open items the owner has not yet decided on:
- HIGH: OTP global 24h cap (`otpDailyCap`, default 300) is one shared bucket. ~15 IPs x 20/day with random 010 numbers exhausts it in <1h and locks every owner out of login/claim for up to 24h; attacker can keep it saturated. Recommended: separate budget for phone numbers that already have a `contacts` row (known owners), plus Turnstile once usage passes ~50%.
- MEDIUM: owner 30-day notify cap (30) can be burned by anyone who saw a tag's QR (5/day per tag x 6 days, fresh cookie per thread so `block` does not help). Recommended: exclude messages in owner-blocked threads from cap counts + show cap usage in /my.
- LOW: `short_links` rows are only removed by thread cascade (~33 days); global OTP cap count+insert is not atomic (bounded overshoot); `ConsoleNotifier` logs the signed reply link (dev only); provider `err.message` is stored/logged raw.

**Why:** caps are fixed numbers by design (patent constraint: no response-rate logic, no escalation). The team consciously traded unbounded SMS cost for an availability risk; the review's job was to size that risk, not remove the cap.

**How to apply:** on the next review of auth.ts / notifications.ts / short-links.ts, check whether the budget partition and blocked-thread exclusion landed before re-reporting; do not re-flag the fixed-cap design itself.
