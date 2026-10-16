# AI_LOG.md

> Drafted by the AI assistant from this build session. **Review and edit before submitting** — it should reflect what you actually did and understand.

## Tools used
- **Claude (Anthropic)** in claude.ai with a sandboxed Linux environment (Node 22, PostgreSQL 16 installed in the sandbox) to write, run and test all code.
- Verification tooling: Vitest, Supertest, React Testing Library, `tsc`, `psql`, `curl`, and mutation checks (temporarily breaking safeguards to confirm tests fail).

## Two important prompts
1. **The master build prompt** (full spec: stack, formulas, 8 financial test cases, three tools, server-enforced confirmation, 5 AI conversations, design constraints, staged execution). It fixed the hard parts up front: exact decimal maths, the LTV ceiling, concurrency-safe duplicates, "backend enforces confirmation, not the prompt".
2. **"Build the whole model" → "Continue"** — the instruction to execute the spec end to end in staged, verified steps.

*(Add your own follow-up prompts here if you used others.)*

## One specific AI-generated mistake
**Wrong repayment estimate at 0 % interest.** My first EMI estimate computed `EMI = P/n`, rounded it to 2 dp, then derived `totalInterest = EMI × n − P`. For ₹2,16,562 over 12 months that gave `-0.04` interest (18,046.83 × 12 = 2,16,561.96) — negative interest shown to a borrower.
- **How it was found:** the unit test I wrote for the zero-rate edge case failed (`expected '-0.04' to be '0.00'`).
- **Fix:** the 0 % branch returns total repayable = principal and interest exactly 0.
- **Test preventing it:** `tests/domain/quote.test.ts` → *"EMI with 0% rate is principal / n"*.

## Other mistakes caught during the build
- **Plan snapshots stored `"10.5"` instead of the documented `"10.50"`** (Prisma Decimal drops trailing zeros) — caught by the *"historical snapshot is immutable"* integration test; fixed at the source (`toPlanTerms`).
- **Demo assistant logic holes** found while tracing conversations: "Is gold a better investment?" slipped past the off-topic check because it contained "gold", and a plan *comparison* question could select a plan. Fixed; covered by *Conversation 5* and *"does not choose a plan when merely comparing"*.
- **Test-harness bugs:** a `*/` inside a comment broke `globalSetup`; React 18/19 mismatch (a transitive dependency hoisted React 19) broke component tests; aligned on React 19.
- **A design choice verified, not assumed:** the spec warns that a transaction alone doesn't prevent duplicate races. Removing the advisory lock makes *"concurrent duplicate submissions: exactly one succeeds"* fail, which confirms the test actually exercises the race.

## Follow-up change: free models only
The user asked not to depend on a paid API key. Added an OpenAI-compatible provider (local Ollama needs no key; free-tier hosts need only a free key), made `auto` selection free-first (a stray key no longer enables a paid provider), kept Anthropic as an explicit opt-in. Covered by `tests/ai/openaiProvider.test.ts`.

## What I (the human) should still verify
Run `npm run db:migrate` (not executed in the build environment), exercise a real free model (e.g. Ollama) with the manual path in the README, and view the UI at 375 / 768 / 1280 px.
