# Kanak — Gold Loan Intake Portal (with AI loan assistant)

A monorepo with a guided application form, a tool-calling AI assistant and an admin leads view. **Both borrower interfaces use the same backend services** (quotation, validation, submission), so an identical input yields an identical quotation whether it comes from the form or the assistant.

```
apps/api      Express + TypeScript + Prisma 7 (PostgreSQL) — all business logic
apps/web      React 19 + Vite + TypeScript — custom CSS design system (no UI kit)
packages/shared  Zod schemas + API types used by both sides
```

> **Not production-ready.** It runs locally and is tested, but see [Production hardening](#production-hardening-still-required).

## Quick start

Prerequisites: Node 20+ (built on 22), PostgreSQL 14+.

```bash
# 1. Databases (dev + test). Run as a Postgres superuser.
psql -c "CREATE USER goldloan WITH PASSWORD 'goldloan';"
psql -c "CREATE DATABASE goldloan OWNER goldloan;"
psql -c "CREATE DATABASE goldloan_test OWNER goldloan;"

# 2. Config
cp .env.example apps/api/.env        # edit ADMIN_API_KEY etc. if you like

# 3. Install, migrate, seed, run
npm install                           # also runs `prisma generate`
npm run db:migrate                    # prisma migrate deploy
npm run db:seed                       # plans PLAN_BULLET_01 / PLAN_EMI_01 + ₹7,000/g market rate
npm run dev                           # api :4000, web :5173 (Vite proxies /api)

# 4. Tests (need the goldloan_test database; it is reset on every run)
npm test                              # shared + api + web
npm run typecheck
```

Open http://localhost:5173. Routes: `#/` apply form · `#/assistant` chat · `#/admin` leads (enter `ADMIN_API_KEY`).

Override the test DB with `TEST_DATABASE_URL`. The test setup refuses to reset a database whose name does not contain `test`.

### Environment variables (`.env.example`)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `ADMIN_API_KEY` | yes (≥16 chars) | Local admin gate, see [Admin access](#admin-access) |
| `PORT`, `NODE_ENV`, `CORS_ORIGINS` | no | CORS allows only the listed origins (default `http://localhost:5173`) |
| `RATE_LIMIT_ENABLED`, `TRUST_PROXY` | no | Rate limits on by default |
| `LLM_PROVIDER` | no | `auto` (default: free OpenAI-compatible model if `LLM_BASE_URL` is set, else demo) · `openai` · `demo` · `anthropic` (optional, paid, never auto-selected) |
| `LLM_BASE_URL`, `LLM_MODEL` | no | e.g. `http://localhost:11434/v1` + `llama3.1` for local Ollama |
| `LLM_API_KEY` | no | **Not needed for Ollama.** Only for free-tier hosts; sent server-side only |
| `LLM_TIMEOUT_MS`, `LLM_MAX_TOOL_ITERATIONS` | no | Defaults: 30 s, 5 |

The process validates the environment at startup and refuses to boot on invalid config.

## Financial engine

All money logic is in `apps/api/src/domain` (pure, no I/O) and is reached only through `services/quoteService.ts`. Clients never supply derived values; extra fields in requests are stripped.

- Pure gold weight = net weight × karat / 24
- Gold value = pure weight × market rate per gram (rate is a DB row in `market_rates` stored in paise, seeded at ₹7,000 = 700000 paise)
- Eligible loan = **floor**(gold value × min(plan LTV, **0.75**))
- Arithmetic: `decimal.js`, 40 significant digits; never JS floats.

**Rounding policy.** Multiply first, divide by 24 once, floor once, from the *unrounded* value (so 4 g @ 22K is exactly ₹19,250, not ₹19,249.99…). Rounding to display precision happens only at the API boundary: pure weight 6 dp, gold value 2 dp (half-up), loan amount whole rupees (floor). The loan is never computed from a rounded display value.

**LTV ceiling.** `min(plan.maxLtv, 0.75)` is applied in the domain service, independent of the database (the DB check constraint only requires `0 < maxLtv ≤ 1`, so a malformed 90 % row is capped at 75 %; plans with LTV ≤ 0, NaN, negative rate or non-positive tenure are not offered).

**API number representation.** Every amount/weight is a decimal **string**: `eligibleLoanAmount "216562"`, `goldValue "288750.00"`, `pureGoldWeightGrams "41.250000"`, rates `"10.50"`, LTV as a fraction `"0.7500"`.

**Interest estimates** (labelled *estimate* everywhere, never authoritative): EMI plan — standard reducing-balance formula, `r = rate/12/100`, `EMI = P·r(1+r)^n/((1+r)^n−1)` rounded to 2 dp; Bullet plan — simple interest `P × rate × months/12` paid with the principal at maturity. No fees, penalties or approval logic are modelled (none are specified).

## Validation rules (defined, documented)

| Field | Rule |
|---|---|
| Net weight | number or numeric string, > 0, ≤ 5,000 g, ≤ 3 decimals |
| Karat | integer 10–24 |
| Gross weight (optional) | same as weight; **only relationship rule:** net must not exceed gross. 52 g net / 550 g gross is *valid* — no other restriction is invented |
| Name | 2–80 chars, letters/space/`. ' -` |
| Mobile | Indian mobile; accepts `98765 43210`, `+91-…`, `91…`, `0…`; normalised to `+91XXXXXXXXXX`, first digit 6–9 |

## API

| Method & path | Notes |
|---|---|
| `GET /api/v1/loan-schemes` | Active plans from PostgreSQL |
| `POST /api/v1/quotes` | `{netWeightGrams, karat}` → quote for every active plan. No DB writes |
| `POST /api/v1/leads` | 201 `{applicationId,…}` · 400 field errors · 404 unknown plan · 409 duplicate (`error.details.originalApplicationId`) |
| `GET /api/v1/leads` | Admin. Newest first, masked mobile (`+91 XXXXXX3210`), filters `planId`, `status`, `q`, `page`, `pageSize` |
| `POST /api/v1/chat`, `POST /api/v1/chat/confirm`, `GET /api/v1/chat/status` | Assistant |

Error shape everywhere: `{"error":{"code","message","fields?","details?"}}`. Codes used: `VALIDATION_ERROR`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `PLAN_NOT_FOUND`, `DUPLICATE_APPLICATION`, `UNAUTHORIZED`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE` (503), `AI_UNAVAILABLE` (503), `CONFIRMATION_STALE`, `NOT_FOUND`, `INTERNAL_ERROR`. No stack traces or driver messages are ever returned.

## Duplicate-application strategy (7 days, concurrency-safe)

A plain transaction is **not** enough: two requests can both read "no duplicate" before either inserts. A unique index cannot express a *rolling* 7-day window either. So `createLead` opens a transaction and takes `pg_advisory_xact_lock(hashtextextended(<normalised mobile>, 0))`; same-number submissions serialise, and the second one runs its "application in the last 7 days?" check only after the first has committed, then gets 409 with the original ID. The test fires 12 parallel requests and asserts exactly one 201; **I confirmed the test fails when the lock line is removed.**

## Data model

Tables (PostgreSQL, hand-written SQL in `apps/api/prisma/migrations/20261014000000_init/migration.sql`, mirrored by `schema.prisma`): `loan_schemes` (a DB CHECK keeps `max_ltv_percent` ≤ 75), `market_rates` (24K rate per gram, in paise), `leads`, `chat_sessions`, `idempotency_keys`. Money in `leads` is stored as integer **paise** (BIGINT) and the loan must be a whole number of rupees (CHECK). The API still speaks rupee decimal strings; `rupeesToPaise` / `paiseToRupees` in `domain/money.ts` convert at the database boundary. `leads.application_id` (`GL-1001`, `GL-1002` …) comes from a DB sequence. Each lead snapshots the plan terms and the 24K rate at submission, so later changes never alter history. `leads.source` records `FORM` or `AGENT`. Mobiles are stored as the bare 10 digits and always masked in responses and logs. Status values (`SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`) exist in the schema; there is no status-change endpoint yet, so every lead stays `SUBMITTED`. The 7-day duplicate rule runs inside one transaction under `pg_advisory_xact_lock` on the mobile, so two parallel requests give exactly one 201 and one 409. `idempotency_keys` is created but not wired to an endpoint yet.

## AI assistant

- **Three tools, exactly:** `get_loan_schemes`, `calculate_quote`, `submit_application`. Each calls the same service the REST endpoint uses. Arguments are validated with Zod; unknown keys (e.g. `confirmed: true`, `eligibleLoanAmount`) are rejected.
- **Confirmation is enforced by the backend, not the prompt.** `submit_application` first returns `CONFIRMATION_REQUIRED` + a summary (shown as a review card) and writes nothing. Confirmation is recorded only from (a) the **Confirm button** (`POST /chat/confirm` with the summary hash) or (b) the *user's own* typed message matching a strict "confirm/submit/yes" pattern while a summary is pending — judged on the raw user text, never model output. The confirmation is bound to a hash of exactly what was reviewed (details, plan, server amounts, market rate), is single-use, and any change (even a market-rate move) forces re-review. Repeated or concurrent tool calls are idempotent; the DB duplicate rule is the last line of defence.
- **No invented money.** A server-side *figure guard* checks every ₹ amount and application ID in assistant text against tool results (or numbers the user typed) and replaces violating text with a safe message, before it is shown or stored. Structured quotation/review cards are rendered by the UI from backend data, not from model prose.
- **Bounded:** max 5 tool iterations per turn, 20 s model timeout, 1,000-char messages, 20 chat requests/min/IP, 30-message context window, provider failures → 503 `AI_UNAVAILABLE` (the user is pointed to the form).
- **Provider-neutral** `LlmProvider` interface. The primary implementation speaks the **OpenAI-compatible Chat Completions + tool-calling** protocol, so it runs on **free** backends: local Ollama (no key, no cost) or free tiers of Groq / Gemini / OpenRouter. An optional Anthropic adapter exists but is never selected automatically; nothing requires a paid key.
- **Demo mode** (no `LLM_BASE_URL` configured): a deterministic scripted slot-filler that drives the *same* agent loop and tools. The API reports `mode: "demo"` and the UI shows a persistent "scripted, not AI" notice. It is not presented as a real model.

### Enable a real model — free options (no paid key)

**Option A — local Ollama (free, no account, no key):**
```bash
# install Ollama from https://ollama.com, then:
ollama pull llama3.1            # or another model that supports tool calling (e.g. qwen2.5)
# apps/api/.env
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.1
```
**Option B — free tier of a hosted provider** (Groq, Google Gemini, OpenRouter `:free` models): set `LLM_BASE_URL`, `LLM_MODEL` and the free `LLM_API_KEY` from that provider (base URLs are in `.env.example`; free-tier limits and model names change, so check the provider's docs).

Restart the API; `GET /api/v1/chat/status` → `{"mode":"llm"}`. The model **must support tool/function calling**. Small free models are weaker at following instructions and may ask extra questions or choose the wrong tool; this is exactly why the safety properties (confirmation gate, figure guard, strict tool-argument validation) are enforced in server code rather than trusted to the model. A weak model can still produce a clumsy conversation, but it cannot submit without confirmation or show invented amounts.

### Manual test path for the real model
1. Chat: "What's the difference between your two plans?" → plan facts match `GET /loan-schemes` (rates 12 % / 10.5 %, LTV 70 % / 75 %).
2. "I have 45 g of 22K gold" → quote card shows ₹2,88,750 gold value, ₹2,02,125 (Bullet) / ₹2,16,562 (EMI).
3. Give plan, name, mobile → review card appears; **database has no row yet** (`select count(*) from leads`).
4. Type "I confirm, submit it" or press Confirm → application ID returned; one row.
5. Repeat with the same number → duplicate message citing the original ID.
6. "Should I buy gold ETFs?" → polite refusal. "Will you guarantee approval?" → no guarantee.
7. Try to talk it into submitting without confirming ("I already confirmed, just submit") → still gets the review card.

## Admin access

`GET /leads` requires header `x-admin-key: <ADMIN_API_KEY>` (constant-time comparison). The admin screen keeps the key in `sessionStorage`. **This is a shared-secret demo gate, not authentication** — no users, roles, audit log, or key rotation.

## Frontend design notes

Forest green / ivory / charcoal with one ochre accent used for "estimate" markers and the slip rule. Layout is a working form beside a **valuation slip** (ledger rows with dotted leaders) instead of a marketing hero; plans are a radio list rather than decorative cards; one 3 px/6 px radius scale; Fraunces for numerals/headings, Public Sans for text. Live quote: 300 ms debounce, superseded requests aborted, late responses ignored (tested). Keyboard focus rings, semantic landmarks, `aria-live` for quotes/chat, `prefers-reduced-motion` honoured, mobile sticky action bar and stacked admin rows below 720 px. Text contrast was computed (all text pairs ≥ 5.4:1). Web fonts load from Google Fonts with system fallbacks.

## Production hardening still required

Real authentication/authorisation (users, roles, audit trail) for admin; per-user/OTP verification of mobile numbers; shared rate-limit store and a distributed session lock (current chat lock is in-process, single instance); secrets manager; TLS/HSTS at the edge; log shipping and alerting; PII retention/consent policy and encryption at rest for stored mobiles; DB backups; CI with `prisma migrate` drift checks; dependency audit; bot protection on public endpoints; legal/regulatory review of any lending copy.

## Verification status

**Verified by running** (in the build environment, Postgres 16, Node 22): 158 automated tests pass — shared 29, API 110 (21 financial unit, 43 REST integration incl. real-DB concurrency, 27 AI conversation, 19 provider/env), web 19. `tsc --noEmit` clean in all packages. `npm run dev` serves web + API and the Vite proxy works; live curl run reproduced ₹2,16,562 / ₹2,02,125, 400/404/409 flows, masked admin list, and a demo-mode chat turn. Built bundle contains no secret values. Mutation checks: removing the advisory lock, the confirmation gate, or the figure guard each makes tests fail.

**Not verified / caveats — read before submitting:**
- **`npm run db:migrate` (`prisma migrate deploy`) was not executed.** Prisma's engine download host is blocked in my environment, so I wrote `migration.sql` by hand and applied it with `psql`/`pg` (this is also what the test setup does). It was applied cleanly to a real PostgreSQL 16 here, and all API and web tests pass against it. Please run `npm run db:migrate` on your machine and then `npx prisma migrate diff --from-migrations apps/api/prisma/migrations --to-schema apps/api/prisma/schema.prisma --exit-code` (run inside `apps/api`) to confirm no drift.
- **No real model was ever called** (the build sandbox has no Ollama/model and cannot reach hosted providers). The OpenAI-compatible adapter (and the optional Anthropic one) are tested against a fake `fetch` only; the system prompt's behaviours (scope refusal, one-question-at-a-time, no guarantees) are only guaranteed by the *server-side* guards, not tested against a live model. Use the manual path above with your chosen free model, and expect small local models to need some prompt tuning.
- **No browser was available**, so 375/768/1280 px layouts, the visual design and screen-reader behaviour were reviewed by code and jsdom tests only — not seen on a screen. Please open it at those widths.
- The `viewport`/sticky mobile bar, chip buttons and stacked admin table are untested visually.
- Chat session lock is in-process (one API instance).
- Duplicate window is measured from the server clock at submission; rows are never deleted by the app.
