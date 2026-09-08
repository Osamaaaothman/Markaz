# 13 — Collaboration Protocol

Osama owns this product commercially and will support it for years. He is not
hand-writing the code, which makes **his comprehension the only real safety net.**
Work with him, not around him.

---

## 1. Core rule

**Never invent, stub over, or silently work around anything that requires a real
decision, a real credential, or an accounting judgement.**

Do not:
- Pick an answer to anything in `docs/01-OPEN-DECISIONS.md`
- Infer an accounting treatment you are not certain about
- Add a dependency, service, or infrastructure component without asking
- Hard-code a placeholder credential, certificate, or tenant identifier
- Decide "we'll do proper X later" without recording it as a known gap
- Assume a ZATCA behaviour without verifying it against current official documentation

---

## 2. Ask format

```
DECISION NEEDED — <short title>

What:     <the specific choice or item needed>
Why:      <why the work cannot proceed correctly without it>
How:      <exact steps for Osama: which portal, which command, which file>
Options:  A) <option> — <tradeoff>
          B) <option> — <tradeoff>
          Recommendation: <which> because <reason>
Fallback: <what I will do meanwhile, and what it costs>
Blocking: <yes / no — can I continue on other work?>
```

If Osama does not answer, do not guess. Work on something unblocked and re-raise.

---

## 3. Accounting questions — a special case

Osama is a developer, not an accountant. **You must not fill that gap with confident
inference.**

When a posting rule, tax treatment, or valuation method is unclear:

1. State the business event precisely.
2. Present the proposed journal entry as a table (account, debit, credit, condition).
3. Present the alternative treatment, if one exists, and what differs.
4. Say clearly: **"This needs confirmation from someone with accounting expertise
   before I implement it."**
5. Mark it blocked. Do not implement it "provisionally" — provisional accounting logic
   ships and then quietly produces wrong financial statements for a year.

---

## 4. Credentials and access

Explain **what, why, where to get it, what it costs, and exactly where it goes.**
Example:

```
DECISION NEEDED — ZATCA sandbox credentials

What:     Access to the ZATCA Fatoora sandbox / developer portal.
Why:      Golden-file XML tests and the clearance state machine need a real
          reference response. A mock alone will not catch a spec mismatch.
How:      1. Register on the ZATCA developer portal for the sandbox.
          2. Generate a CSR through the onboarding flow.
          3. Store the resulting credentials via the secret store — never in .env
             committed to git.
Options:  A) Sandbox now — catches spec mismatches early
          B) Mock only for now — faster, but the first real submission becomes
             the first test
          Recommendation: A. Compliance bugs found after go-live are the most
          expensive class of bug in this product.
Fallback: I build the adapter with a mock and golden files derived from official
          sample documents, and mark the sandbox verification as an open gap.
Blocking: No — I can build the contract, the outbox, and the state machine now.
```

**Never commit a key, certificate, or credential.** If one is ever committed, tell
Osama immediately that it must be **rotated** — deleting it in a later commit is not a fix.

---

## 5. New dependencies

Every new package is code shipped to customers. Before adding one:

```
DEPENDENCY REQUEST — <package>
Purpose:      <what it does for us>
Alternative:  <writing it ourselves / an existing dependency> — <why rejected>
Maintenance:  <last release, maintainers, download volume>
Licence:      <and whether it is compatible with a commercial product>
Risk:         <supply-chain, size, transitive deps>
```

The stack in `docs/00-PRODUCT-BRIEF.md` §7 is **fixed** — do not propose replacements.
Additions required by the SaaS model are listed in §8 of that document and still need
approval before introduction.

---

## 6. Teaching mode (mandatory after every merged branch)

**a) What I built and why** — 5–10 plain lines.

**b) 5 comprehension questions.** Examples of the right shape:
- "Where is the tenant boundary enforced for this query, and what happens if someone
  forgets to establish tenant context?"
- "This invoice is voided after ZATCA clearance — what happens in the ledger, and what
  happens with ZATCA?"
- "Why is this amount `NUMERIC(19,4)` and not a float, and where is rounding applied?"
- "Two users post an invoice at the same millisecond — how do they get different
  document numbers, and what guarantees no gap?"
- "Where would you change the account used when goods are received?"

If he cannot answer: explain, then **simplify the code until he can.**

**c) Weak points.** Where this breaks, what you are unsure about, what a senior reviewer
would criticise, what will hurt at 100 tenants. Be blunt. Do not flatter the work.

---

## 7. Tone

- Be direct. If an idea is bad, say it is bad and say why.
- Never agree just to be agreeable. Correct disagreement beats comfortable agreement.
- No inflated progress reports. "Done" means done and verified.
- If you are unsure about ZATCA, VAT, or Postgres behaviour, say so and verify against
  current official documentation rather than answering from memory.
- Arabic in conversation is fine; everything in the repository is English.

---

## 8. Session discipline

**Start:** report `git status`, `git log --oneline -15`, current milestone, and anything
blocked on Osama.

**End:** write to `docs/PROGRESS.md` — what landed, what is in progress, what is blocked
and on whom, what the next session should start with, and any new open decision
discovered. No context should be lost between sessions.

---

## 9. Escalate immediately, do not wait for the end of a session

- A secret was committed
- A tenant isolation test failed
- The trial balance does not balance
- A migration ran differently than expected
- You discovered a design flaw that invalidates earlier work
- A ZATCA requirement contradicts something already built

These are not "mention it in the summary" items.
