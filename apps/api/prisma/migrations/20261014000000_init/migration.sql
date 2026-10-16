-- Gold Loan Portal schema (PostgreSQL 14+).
-- Money convention: BIGINT paise (1 INR = 100 paise). Never float.
-- Loan amounts are whole rupees, enforced by CHECK (multiple of 100 paise).
-- Mobile numbers are stored as the bare 10 digits (the API adds/removes the +91 prefix).

-- ---------- Enums ----------
CREATE TYPE repayment_type AS ENUM ('BULLET', 'EMI');
CREATE TYPE lead_status    AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE lead_source    AS ENUM ('FORM', 'AGENT');   -- both paths use the same service layer

-- ---------- loan_schemes ----------
CREATE TABLE loan_schemes (
    id                    TEXT PRIMARY KEY,                       -- e.g. PLAN_BULLET_01
    name                  TEXT           NOT NULL,
    repayment_type        repayment_type NOT NULL,
    annual_interest_rate  NUMERIC(5,2)   NOT NULL
                          CHECK (annual_interest_rate >= 0 AND annual_interest_rate <= 100),  -- percent p.a.
    tenure_months         SMALLINT       NOT NULL CHECK (tenure_months > 0),
    max_ltv_percent       NUMERIC(5,2)   NOT NULL
                          CHECK (max_ltv_percent > 0 AND max_ltv_percent <= 75),  -- hard cap: never above 75%
    is_active             BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- ---------- market_rates (24K gold, per gram, latest effective_from wins) ----------
CREATE TABLE market_rates (
    id                      SERIAL PRIMARY KEY,
    rate_per_gram_paise     BIGINT      NOT NULL CHECK (rate_per_gram_paise > 0),
    effective_from          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_market_rates_effective ON market_rates (effective_from DESC, id DESC);

-- ---------- leads ----------
CREATE SEQUENCE application_id_seq START WITH 1001 INCREMENT BY 1;

CREATE TABLE leads (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id            TEXT NOT NULL UNIQUE
                              DEFAULT ('GL-' || nextval('application_id_seq')),   -- GL-1001, GL-1002 ...

    -- borrower
    borrower_name             TEXT     NOT NULL CHECK (length(btrim(borrower_name)) BETWEEN 2 AND 100),
    mobile                    CHAR(10) NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),  -- stored raw; ALWAYS mask in API/logs

    -- gold (gross is optional: the form and assistant may omit it)
    gross_weight_grams        NUMERIC(10,3) CHECK (gross_weight_grams > 0),
    net_weight_grams          NUMERIC(10,3) NOT NULL CHECK (net_weight_grams > 0),
    karat                     SMALLINT      NOT NULL CHECK (karat BETWEEN 10 AND 24),
    CONSTRAINT chk_net_le_gross CHECK (gross_weight_grams IS NULL OR net_weight_grams <= gross_weight_grams),

    -- plan + snapshot of terms at time of application (schemes can change later)
    plan_id                   TEXT NOT NULL REFERENCES loan_schemes(id),
    interest_rate_snapshot    NUMERIC(5,2)  NOT NULL,
    tenure_months_snapshot    SMALLINT      NOT NULL,
    max_ltv_percent_snapshot  NUMERIC(5,2)  NOT NULL CHECK (max_ltv_percent_snapshot <= 75),

    -- server-computed quote (never trust client numbers)
    rate_24k_per_gram_paise   BIGINT        NOT NULL CHECK (rate_24k_per_gram_paise > 0),
    pure_gold_grams           NUMERIC(14,6) NOT NULL CHECK (pure_gold_grams > 0),
    gold_value_paise          BIGINT        NOT NULL CHECK (gold_value_paise >= 0),
    eligible_loan_paise       BIGINT        NOT NULL CHECK (eligible_loan_paise >= 0),
    CONSTRAINT chk_loan_whole_rupees CHECK (eligible_loan_paise % 100 = 0),
    CONSTRAINT chk_loan_le_value     CHECK (eligible_loan_paise <= gold_value_paise),

    status                    lead_status NOT NULL DEFAULT 'SUBMITTED',
    source                    lead_source NOT NULL DEFAULT 'FORM',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin table: newest first (stable pagination) + plan filter
CREATE INDEX idx_leads_created_at     ON leads (created_at DESC, id DESC);
CREATE INDEX idx_leads_plan_created   ON leads (plan_id, created_at DESC);
-- 7-day duplicate lookup by mobile
CREATE INDEX idx_leads_mobile_created ON leads (mobile, created_at DESC);

-- ---------- chat_sessions (server-side agent state incl. the confirmation state machine) ----------
CREATE TABLE chat_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    messages      JSONB       NOT NULL DEFAULT '[]',
    slots         JSONB       NOT NULL DEFAULT '{}',
    confirmation  JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- idempotency (bonus; table is ready, endpoint not wired yet) ----------
CREATE TABLE idempotency_keys (
    key              TEXT PRIMARY KEY,
    request_hash     TEXT        NOT NULL,   -- same key + different body => 422
    response_status  SMALLINT    NOT NULL,
    response_body    JSONB       NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_idem_created ON idempotency_keys (created_at);

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_loan_schemes_updated  BEFORE UPDATE ON loan_schemes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leads_updated         BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_chat_sessions_updated BEFORE UPDATE ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- NOTE (duplicate rule): "one lead per mobile per 7 days" cannot be a plain UNIQUE index because the
-- window moves. leadService.createLead takes pg_advisory_xact_lock(hashtextextended(mobile)) inside
-- one transaction, checks for a lead in the last 7 days, then inserts. Two parallel requests for the
-- same new mobile therefore give exactly one 201 and one 409.
