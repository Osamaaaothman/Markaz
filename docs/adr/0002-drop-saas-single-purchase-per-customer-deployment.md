# ADR-0002: Drop SaaS — single-purchase, isolated per-customer deployment

## Status
Accepted — 2026-09-09. **Supersedes ADR-0001** in full.

## Context

ADR-0001 (2026-09-09, same day) decided SaaS-primary with schema-per-tenant isolation.
Within the same session, Osama reversed that decision after considering the
operational and security cost of custodying every customer's ZATCA private keys, and
the fact that the realistic buyer in this market (Gulf trade/distribution businesses,
including large enterprises that will insist on control of their own data) is better
served by a model closer to the *original* planning document's on-premise stance —
but refined with lessons from the SaaS discussion rather than a plain reversion.

The discussion covered three separate axes that were being conflated and needed to be
separated:
1. **Pricing model** — subscription vs. one-time purchase.
2. **Frontend runtime** — desktop (Electron) vs. web.
3. **Hosting location** — customer's own hardware vs. a cloud account.

## Decision

1. **Pricing: one-time purchase**, not subscription. Detailed packaging/pricing is
   deferred (`docs/01-OPEN-DECISIONS.md` B1/B2) — not blocking architecture work.
2. **Deployment: fully isolated, single-tenant per customer. No shared multi-tenant
   platform.** Each customer gets their own complete deployment (own database, own
   backend, own ZATCA keys, own everything) via Docker Compose. There is no `platform`
   schema, no cross-customer database, and no schema-per-tenant mechanism — that
   entire layer from ADR-0001 is dropped, not just made "configurable."
3. **Frontend stays a web app** (React + TypeScript + Vite + PrimeReact, per
   `docs/00-PRODUCT-BRIEF.md` §7) — **not Electron.** The one real requirement that
   pointed toward a desktop app — access to a local printer or other hardware attached
   to an employee's machine — is solved instead with a **small local print/hardware
   agent**: a lightweight background helper installed once per machine that needs it,
   exposing local devices to the web app over `localhost`. This keeps the primary
   application a plain web app (far cheaper to build, ship, and update — no per-OS
   packaging, signing, or auto-updater) while still solving the real need.
4. **Hosting is a per-customer choice, not a fixed answer:**
   - **(a) Customer's own physical server** — true on-premise. The customer owns
     backup/maintenance; Osama installs and hands over, per
     `docs/12-OPS-AND-DEPLOYMENT.md`.
   - **(b) A cloud account the customer pays for and nominally owns** (e.g. Railway),
     with Osama operating the deployment on it. This is a **third, hybrid model** —
     the customer holds the bill and the account, but Osama holds admin access and
     does the deployment/update work, which carries the same access-logging
     obligation as any privileged access to a live customer system
     (`docs/09-SECURITY-RULES.md` §3).
   - The same Docker images/Compose bundle target both. Data residency (does the
     chosen cloud provider have a Saudi/Gulf region, does the customer care) is
     evaluated **per customer** at hosting-choice time, not decided once for the whole
     product — see the updated `docs/01-OPEN-DECISIONS.md` A2.
5. **Licensing/activation is back** (dropped in ADR-0001 for the SaaS path, now
   needed again for a sold, per-customer-deployed product). Design:
   - A **central Activation Service**, operated by Osama, separate from every
     customer's deployment. It is the one piece of infrastructure that legitimately
     deals with many customers' data (license records — not business/financial data).
   - Each customer deployment holds a **master license key**; each employee seat
     added within that deployment gets a **sub-key** counted against the license's
     seat limit. The sub-key is a **licensing/entitlement concept only** — it is not a
     second authentication system. User login/permissions remain entirely owned by
     `IPermissionService` inside the customer's own deployment.
   - **Validation is periodic with an offline grace period**, not a hard requirement
     to be online. A deployment checks in with the Activation Service on an interval
     (proposed: weekly); if unreachable, it keeps working normally for a generous
     grace window (proposed: 30 days) before warning, and a longer window before any
     lockout. A financial system of record must not go dark because Osama's server or
     the customer's internet had a bad day — see `docs/00-PRODUCT-BRIEF.md` §1.
     Exact interval/grace-period lengths and what triggers lockout are implementation
     detail to confirm with Osama before M8-equivalent work, not fixed by this ADR.

## Alternatives considered

- **Keep SaaS (ADR-0001).** Rejected: the ongoing obligation to custody every
  customer's ZATCA private keys, plus this market's preference for owning their own
  financial data, outweighed SaaS's operational convenience for this product.
- **Full Electron desktop app.** Rejected as the default: it solves a narrower problem
  (local hardware access) at a much higher fixed cost (per-OS packaging, code signing,
  an auto-updater, a second UI runtime to maintain) than a small local print/hardware
  agent achieves for the same problem. Not ruled out forever — if a real offline
  requirement emerges later, this decision should be revisited explicitly, not drifted
  into.
- **Hard "always online" license enforcement.** Rejected: makes Osama's own uptime a
  single point of failure for every customer's ability to run their business, which is
  unacceptable for a system that must "work every fiscal period" (`CLAUDE.md` §0).
- **Permanent one-time offline activation with no further check-in.** Rejected: gives
  up any ability to enforce license terms or seat limits after initial activation,
  which undermines the commercial model even though it's the safest choice for
  customer uptime. The periodic-check-with-grace-period design is the compromise.

## Consequences

**Gets easier (relative to ADR-0001):**
- No cross-schema migration runner, no `search_path` leak risk, no platform schema —
  `docs/03-MULTI-TENANCY-RULES.md` collapses to "one company per deployment."
- Osama no longer custodies every customer's ZATCA private key — each deployment
  holds its own, matching the original planning document's Onboarding model
  (`docs/06-COMPLIANCE-PACK-RULES.md`).
- Frontend build/release pipeline stays simple (plain web deploy, no OS-specific
  packaging or signing).

**Gets harder:**
- Every update/migration must be rolled out **per customer deployment** rather than
  once centrally — this is *more* ongoing operational work per customer than SaaS,
  not less, and grows linearly with customer count. Needs a real rollout runbook
  before more than a handful of customers exist.
- Two hosting paths (customer hardware vs. customer-paid cloud) means two sets of
  operational assumptions to support and document, not one.
- A new, security-sensitive component (the Activation Service) now exists and must be
  designed, hosted, and secured to the same bar as the rest of this system — it is a
  new single point of trust even though it is deliberately *not* a single point of
  failure for uptime.
- The local print/hardware agent is a new small piece of software (a second codebase,
  even if tiny) with its own install/update story per employee machine.

**Will regret at scale (watch for):**
- Per-customer rollout work could become unsustainable well before it would have
  under SaaS — if customer count grows significantly, revisit whether some form of
  managed/hosted offering (with consent) is worth reintroducing for the customers who
  don't care about data ownership.
- If the Activation Service's check-in/grace-period parameters are set wrong (too
  aggressive), it recreates the "always online" failure mode by a different path —
  these values need real testing against realistic outage scenarios before launch.
