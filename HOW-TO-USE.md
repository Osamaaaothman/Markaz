# How to use this rules pack

## 1. File placement

```
erp/
├── CLAUDE.md                  ← Claude Code loads this automatically
├── HOW-TO-USE.md              ← this file
└── docs/
    ├── 00-PRODUCT-BRIEF.md
    ├── 01-OPEN-DECISIONS.md
    ├── 02-ARCHITECTURE-RULES.md
    ├── 03-MULTI-TENANCY-RULES.md
    ├── 04-DATA-MODEL-RULES.md
    ├── 05-ACCOUNTING-INTEGRITY-RULES.md
    ├── 06-COMPLIANCE-PACK-RULES.md
    ├── 07-API-RULES.md
    ├── 08-FRONTEND-I18N-RULES.md
    ├── 09-SECURITY-RULES.md
    ├── 10-TESTING-RULES.md
    ├── 11-GIT-WORKFLOW.md
    ├── 12-OPS-AND-DEPLOYMENT.md
    ├── 13-COLLABORATION-PROTOCOL.md
    ├── 14-MILESTONES.md
    ├── adr/                   ← created as decisions are made
    └── planning/              ← put the original Arabic planning document here
```

```bash
git init
git add .
git commit -m "docs: add product rules, architecture constraints, and open decisions"
```

---

## 2. First session with Claude Code

```
Read CLAUDE.md and every file in docs/ before doing anything else.
The original Arabic planning document is in docs/planning/.

Then, before writing any code:
1. Confirm you understand the non-negotiable invariants in CLAUDE.md §1.
2. Tell me every conflict you find between the original planning document
   and docs/00-PRODUCT-BRIEF.md.
3. Walk me through docs/01-OPEN-DECISIONS.md section A one item at a time,
   with your recommendation and reasoning. Wait for my answer on each.

Do not scaffold, do not create files, do not commit until I approve the M0 plan.
```

## 3. Every later session

```
Run git status and git log --oneline -15. Tell me where we are, which milestone
in docs/14-MILESTONES.md is next, and what is blocked on me in
docs/01-OPEN-DECISIONS.md. Then propose the plan for the next unit of work
and wait for my approval.
```

---

## 4. Keep these files alive

They are worthless if they go stale.

- `docs/01-OPEN-DECISIONS.md` — move items out as they are decided; add new ones as
  they surface
- `docs/00-PRODUCT-BRIEF.md` — update when a decision changes the product
- `docs/adr/` — one record per significant decision, written at the time
- `docs/PROGRESS.md` — written at the end of every session

If a rule turns out to be wrong or impractical, **change the rule deliberately and
record why** — do not quietly start ignoring it. A rule everyone ignores is worse than
no rule.

---

## 5. Your responsibilities

Claude Code writes the code. **You own it.**

- Read every diff. If you cannot explain a line, ask until you can.
- Answer the comprehension questions honestly. "I don't know" → make it simplify.
- **Get accounting review** for the posting rules in
  `docs/05-ACCOUNTING-INTEGRITY-RULES.md` §5 before they are implemented. This is the
  one area where being wrong is invisible until a customer's financial statements are
  wrong.
- **Verify ZATCA requirements yourself** against official documentation. Do not accept
  them from any AI, including this one — specs and deadlines change.
- Decide the open items in section A. Everything is blocked behind them.
