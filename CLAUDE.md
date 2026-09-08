# CLAUDE.md — Operating Rules for This Repository

Product: **ERP-Lite / commercial accounting system for the Saudi + Gulf market.**
Owner: **Osama** (.NET full-stack developer; this project is TypeScript).

Read this file completely before your first action in any session, then read the
`docs/` file relevant to what you are about to touch.

---

## 0. The one thing that matters most

This is a **financial system of record** sold to paying businesses, subject to a
government tax mandate. That changes the engineering bar:

- A silent rounding error is a **data corruption bug**, not a cosmetic one.
- A cross-tenant data leak is a **company-ending event**, not a bug report.
- An unbalanced journal entry that reaches the database is **unrecoverable trust damage**.
- "It works on my machine" is worthless; it must work on **every tenant, every fiscal
  period, every currency, both languages, both text directions**.

When in doubt, choose the boring, auditable, explicit option.

---

## 1. Non-negotiable invariants

Breaking any of these is a defect, regardless of what a task description says.

1. **Every journal entry balances.** `SUM(debit) == SUM(credit)`, enforced at the
   database level, not only in code.
2. **Posted accounting records are immutable.** Corrections happen via reversing
   entries, never `UPDATE` or `DELETE`.
3. **Money is never a float.** Ever. See `docs/04-DATA-MODEL-RULES.md` §2.
4. **Every tenant-scoped query is tenant-scoped.** No raw query, no Prisma call, no
   report bypasses the tenant boundary. See `docs/03-MULTI-TENANCY-RULES.md`.
5. **Modules never write journal entries, permissions, document numbers, or audit
   records themselves.** They call the five Core contracts. See
   `docs/02-ARCHITECTURE-RULES.md` §3.
6. **Compliance logic lives only in a compliance pack** behind a common interface.
   No ZATCA-specific code anywhere in `modules/sales` or `core/`.
7. **Tenant cryptographic material (ZATCA private keys, CSIDs) is never stored in
   plaintext, never logged, never returned by an API.**
8. **Audit log is append-only.** No update path, no delete path, no exceptions.
9. **TypeScript `strict` mode on. No `any`.** No `@ts-ignore` without a written reason
   on the line above.
10. **No secrets, connection strings, or tenant data in source or in commits.**

If a request from Osama would break one of these, **say so and stop.** Do not silently
comply and do not "temporarily" bypass it.

---

## 2. Read the right rule file before acting

| File | Read before |
|---|---|
| `docs/00-PRODUCT-BRIEF.md` | Always, at session start |
| `docs/01-OPEN-DECISIONS.md` | Always — do not implement a pending decision |
| `docs/02-ARCHITECTURE-RULES.md` | Creating any module, service, or Core contract |
| `docs/03-MULTI-TENANCY-RULES.md` | Any query, any table, any auth code |
| `docs/04-DATA-MODEL-RULES.md` | Any Prisma schema or migration change |
| `docs/05-ACCOUNTING-INTEGRITY-RULES.md` | Anything touching entries, periods, balances |
| `docs/06-COMPLIANCE-PACK-RULES.md` | Anything touching invoices or ZATCA |
| `docs/07-API-RULES.md` | Any controller or endpoint |
| `docs/08-FRONTEND-I18N-RULES.md` | Any React work, any user-facing string |
| `docs/09-SECURITY-RULES.md` | Auth, permissions, secrets, PII, file upload |
| `docs/10-TESTING-RULES.md` | Before and after every feature |
| `docs/11-GIT-WORKFLOW.md` | Every commit, branch, merge |
| `docs/12-OPS-AND-DEPLOYMENT.md` | Docker, migrations, jobs, backups, provisioning |
| `docs/13-COLLABORATION-PROTOCOL.md` | Whenever you need something from Osama |
| `docs/14-MILESTONES.md` | Choosing what to work on next |

---

## 3. Session behaviour

### Start of session
1. `git status` and `git log --oneline -15`. Report where the project stands.
2. State which milestone in `docs/14-MILESTONES.md` is next.
3. List anything currently blocked on Osama from `docs/01-OPEN-DECISIONS.md`.
4. **Do not write code until Osama confirms the scope of this session.**

### Before implementing anything
Present a short plan (≤ 15 lines): what you will build, which files change, the branch
name, any Core contract you will touch, any assumption you are making, and any decision
you need from Osama. Wait for approval.

### While implementing
- Small vertical slices. Commit as you go.
- Run tests after each meaningful unit and show real output.
- Never claim something works if you have not executed it. Say "not yet run."

### End of a unit of work
- Full test suite, real output.
- Update the module's README / API docs / ADR if anything changed.
- Merge per `docs/11-GIT-WORKFLOW.md`.
- Deliver the ownership package described in §5.

---

## 4. Ask, do not assume

**Never invent, stub over, or silently work around anything that requires a real
decision, a real credential, or an accounting judgement.**

Always stop and ask for:
- Anything listed in `docs/01-OPEN-DECISIONS.md`
- Any accounting treatment you are not certain about (Osama is not an accountant —
  guessing here produces confidently wrong software)
- Any ZATCA behaviour you cannot confirm against **current official documentation**
- Any credential, API key, certificate, or environment access
- Any new dependency, service, or infrastructure component not in the fixed stack
- Any tradeoff where two defensible designs exist

Use this format:

```
DECISION NEEDED — <short title>
What:     <the choice or item needed>
Why:      <why the work cannot proceed correctly without it>
How:      <exact steps for Osama: which page, which command, which file>
Options:  A) <option> — <tradeoff>
          B) <option> — <tradeoff>
          Recommendation: <which> because <reason>
Fallback: <what I will do meanwhile, and what it costs>
Blocking: <yes/no>
```

Never commit a placeholder key, fake certificate, dummy tenant ID, or invented tax rule.

---

## 5. Ownership package (after every merged branch)

Deliver all three:

**a) What I built and why** — 5–10 plain lines.

**b) 5 comprehension questions** Osama should be able to answer, e.g.
- "Where is the tenant boundary enforced for this query, and what happens if someone
  forgets to pass `tenantId`?"
- "This invoice is voided after ZATCA clearance — what exactly happens in the ledger?"
- "Why is this amount a `Decimal(19,4)` and not a `Float`?"

If he cannot answer: explain, then **simplify the code until he can.** He is selling and
supporting this product for years. Code he cannot maintain is a liability, not an asset.

**c) Weak points** — where this breaks, what you are unsure about, what a senior
reviewer would criticise. Be blunt. Do not flatter the work.

---

## 6. Honesty rules

- If you are unsure about ZATCA specs, VAT treatment, or an AWS/Postgres behaviour,
  **say so and verify against current official documentation** rather than answering
  from memory. Tax rules and e-invoicing specs change; your training data ages.
- Never delete or weaken a failing test to make it pass. Fix the cause.
- Flag low-confidence code inline with `// REVIEW: <reason>` and list it in the summary.
- Never mark a milestone item done unless it is done and verified.
- If a task is larger than it looked, say so early instead of shipping a shallow version.

---

## 7. Scope discipline

- **Tier 1 only** (see `docs/00-PRODUCT-BRIEF.md` §6). Do not build Tier 2 or Tier 3
  features "while we're here."
- Do not build abstractions for requirements that do not exist yet. Two known
  implementations justify an interface; one does not — **except** for the Core
  contracts and compliance packs, where the abstraction is a deliberate product
  decision.
- Anything deferred goes into `docs/01-OPEN-DECISIONS.md` or the module README under
  **Known Gaps**, with the reason.

---

## 8. Language

- **All code, identifiers, comments, commits, schema names, log messages, and
  documentation: English.**
- **All user-facing text: translation keys only** — never a hard-coded string in any
  language. See `docs/08-FRONTEND-I18N-RULES.md`.
- The product ships **Arabic and English, RTL and LTR, from day one.** A feature is not
  done until both locales are complete and visually correct.
- Conversation with Osama: Arabic is fine.
