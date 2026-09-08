# 11 — Git Workflow Rules

This is a long-lived commercial product, not a one-off assessment. History exists so
that in two years someone can answer "why is this line here?" and "when did this
behaviour change?"

---

## 1. Prohibitions

| Never | Why |
|---|---|
| One giant commit for a whole feature | Unreviewable, unbisectable |
| `git push --force` on `main` or any shared branch | Rewrites shared history |
| `git commit --amend` on a pushed commit | Same |
| Committing `.env`, secrets, certificates, real customer data | Security incident |
| Committing `node_modules/`, `dist/`, build output, `.DS_Store` | Noise |
| Merging with failing tests or a red CI | Breaks `main` for everyone |
| Editing a migration that has already run anywhere but local | Divergent schemas |

Amend is fine on a local, unpushed commit.

---

## 2. Branches

`main` is always deployable.

```
feat/<module>-<short-description>
fix/<module>-<short-description>
refactor/<module>-<short-description>
test/<module>-<short-description>
perf/<module>-<short-description>
docs/<short-description>
chore/<short-description>
db/<short-description>          ← migrations
i18n/<short-description>
```

Examples: `feat/core-posting-engine` · `feat/inventory-reorder-point` ·
`db/add-fiscal-periods` · `fix/sales-vat-rounding-on-line-discount` ·
`i18n/invoices-arabic-keys`

Rules:
- One branch = one coherent change.
- More than ~10 files or ~500 lines is probably two branches — say so and propose the split.
- Branch from up-to-date `main`.

---

## 3. Commits

### Cadence
Commit at each logically complete step, not at the end. A feature branch typically has
3–8 commits:

```
feat(core): add fiscal period entity and state machine
feat(core): reject postings into closed periods at the service layer
db(core): add fiscal_periods table with closed-period check constraint
test(core): cover period locking, reopening, and backdated posting
fix(core): use tenant timezone when resolving a posting date to a period
docs(core): document the period lifecycle in the module README
```

Do not manufacture fake history — but do not hide real iteration either. A commit that
fixes a bug you introduced an hour earlier is good history.

### Format — Conventional Commits

```
<type>(<scope>): <imperative summary, ≤ 72 chars>

<why this change exists — the diff already shows what>
<tradeoffs considered and rejected>
<BREAKING CHANGE: / Refs #n>
```

Types: `feat` `fix` `refactor` `test` `docs` `chore` `perf` `db` `i18n` `style`
Scopes: `core` `inventory` `purchasing` `sales` `compliance` `identity` `licensing`
`print-agent` `web` `shared` `infra` `ci`

(`identity` covers auth/permissions/audit; `licensing` covers the Activation Service
and its client integration — renamed from `tenancy`/`auth`/`billing` after
`docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md` dropped the
multi-tenant platform.)

Bad: `update`, `fix bug`, `wip`, `changes`
Good: `fix(sales): apply line-level discount before VAT, matching ZATCA line semantics`

### Not in one commit
- A feature plus an unrelated refactor
- Formatting churn mixed with logic (`style:` gets its own commit)
- A schema migration mixed with unrelated application code

---

## 4. Pull requests

Use real PRs even if Osama merges them himself — the description is durable
documentation.

PR template:
```
## What
## Why
## How (design decisions, alternatives rejected)
## Migration / rollout notes
## Tests added
## Screenshots (AR + EN, RTL + LTR) for any UI change
## Risks and known gaps
```

- CI must be green before merge.
- Merge with `--no-ff` (or "Create a merge commit"). The merge point is part of the story.
- Squash-merge is acceptable **only** for a trivial single-purpose branch — never for a
  feature branch with meaningful evolution.
- Delete the local branch after merge; keep the remote branch and the PR.

---

## 5. Pre-commit checklist

```
[ ] git diff --staged reviewed line by line
[ ] no secrets, certificates, connection strings, or real customer data
[ ] no console.log / debug code / commented-out code
[ ] tests for this change exist and pass
[ ] migration (if any) is expand/contract safe and reviewed
[ ] both AR and EN translation keys added
[ ] commit message explains WHY
```

Before pushing:
```bash
git diff --staged | grep -iE "password|secret|api[_-]?key|BEGIN .*PRIVATE KEY|postgres://"
```

Set up **gitleaks** (or equivalent) as a pre-commit hook in Milestone 0. If a secret is
ever committed, it must be **rotated** — removing it in a later commit is not a fix, and
you must tell Osama immediately.

---

## 6. Repository hygiene (Milestone 0)

- `.gitignore`, `.gitattributes`, `.env.example`
- `README.md` maintained continuously, never written all at once at the end
- `CHANGELOG.md` — every breaking change and every migration recorded
- `docs/adr/` populated as decisions are made
- CI: lint, typecheck, build, tests, dependency audit, i18n key parity
- Branch protection on `main`: no direct pushes, CI required, no force push
- Conventional-commit lint (commitlint) and formatting (Prettier) enforced by hook

---

## 7. Releases

- Semantic versioning; tag every release.
- Release notes generated from commits, reviewed by hand.
- Every release records which migrations it contains and whether they are
  backward-compatible.
- Never release a schema change and the code that requires it in a way that cannot be
  rolled back — see the expand/contract rule in `docs/03-MULTI-TENANCY-RULES.md` §6.
