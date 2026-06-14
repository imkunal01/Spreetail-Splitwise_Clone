-- ─────────────────────────────────────────────────────────────────────────────
-- Splitwise – Initial Schema Migration
-- File   : 001_initial.sql
-- Purpose: Create all tables, types, constraints, indexes, and extensions
--          required to run Splitwise in production.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable pgcrypto so gen_random_uuid() is available on PostgreSQL < 14.
-- On PostgreSQL 14+ gen_random_uuid() is built-in, but the extension is harmless.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Enum Types ───────────────────────────────────────────────────────────────

CREATE TYPE split_type    AS ENUM ('EQUAL', 'EXACT', 'PERCENTAGE', 'RATIO');
CREATE TYPE currency_code AS ENUM ('INR', 'USD', 'EUR', 'GBP');
CREATE TYPE import_status AS ENUM (
    'IMPORTED',
    'SKIPPED',
    'ERRORED',
    'IMPORTED_AS_SETTLEMENT'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: users
-- Stores registered accounts and lightweight guest participants.
-- Guest users (is_guest = TRUE) are non-registered people added by a member,
-- e.g. "Dev's friend Kabir". They share no login credentials.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_guest      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),

    CONSTRAINT users_email_unique UNIQUE (email)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: groups
-- A shared expense group, e.g. "Goa Trip 2024".
-- created_by captures which user created the group and acts as implicit admin.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE groups (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    created_by  UUID         NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),

    CONSTRAINT groups_created_by_fk FOREIGN KEY (created_by)
        REFERENCES users (id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: group_memberships
-- Tracks which users belong to which group and for what time range.
-- A member can leave (left_at IS NOT NULL) and later rejoin (new row with
-- a fresh joined_at). The partial unique index prevents two simultaneously
-- active memberships for the same (user, group) pair.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE group_memberships (
    id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID      NOT NULL,
    group_id   UUID      NOT NULL,
    joined_at  DATE      NOT NULL,
    left_at    DATE      NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT gm_user_fk    FOREIGN KEY (user_id)  REFERENCES users  (id) ON DELETE CASCADE,
    CONSTRAINT gm_group_fk   FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE,

    -- A member cannot leave before they joined.
    CONSTRAINT gm_dates_check CHECK (left_at IS NULL OR left_at >= joined_at)
);

-- Prevent duplicate *active* memberships.
-- A user who has left (left_at IS NOT NULL) can rejoin (new row).
CREATE UNIQUE INDEX group_memberships_active_unique
    ON group_memberships (user_id, group_id)
    WHERE left_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: expenses
-- Core financial record for any shared cost.
-- Stores original currency data permanently so historical amounts are never
-- distorted by future exchange rate changes.
-- Negative amounts are legal (refunds). The is_refund and is_settlement flags
-- provide explicit classification without changing sign conventions.
-- The imported_row_hash enables idempotent CSV imports.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE expenses (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id         UUID          NOT NULL,
    description      VARCHAR(255)  NOT NULL,
    amount           DECIMAL(12,2) NOT NULL,
    currency         currency_code NOT NULL DEFAULT 'INR',
    exchange_rate    DECIMAL(10,4) NOT NULL DEFAULT 1.0,
    amount_inr       DECIMAL(12,2) NOT NULL,
    paid_by_id       UUID          NOT NULL,
    date             DATE          NOT NULL,
    split_type       split_type    NOT NULL,
    is_refund        BOOLEAN       NOT NULL DEFAULT FALSE,
    is_settlement    BOOLEAN       NOT NULL DEFAULT FALSE,
    notes            TEXT,
    imported_row_hash VARCHAR(64),
    created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),

    CONSTRAINT expenses_group_fk   FOREIGN KEY (group_id)   REFERENCES groups (id) ON DELETE CASCADE,
    CONSTRAINT expenses_payer_fk   FOREIGN KEY (paid_by_id) REFERENCES users  (id),

    -- Amount must be non-zero (zero would be a no-op; refunds use negative values).
    CONSTRAINT expenses_amount_nonzero   CHECK (amount <> 0),
    -- Exchange rate must always be positive.
    CONSTRAINT expenses_exchange_positive CHECK (exchange_rate > 0)
);

-- Prevent importing the same row twice within the same group.
-- The partial index only applies when imported_row_hash is populated,
-- so manually created expenses (hash IS NULL) are never blocked.
CREATE UNIQUE INDEX expenses_import_hash_unique
    ON expenses (group_id, imported_row_hash)
    WHERE imported_row_hash IS NOT NULL;

-- Standard query-path indexes.
CREATE INDEX expenses_group_id_idx ON expenses (group_id);
CREATE INDEX expenses_date_idx     ON expenses (date);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: expense_splits
-- Records each participant's share of a given expense.
-- The split strategy (EQUAL / EXACT / PERCENTAGE / RATIO) is stored on the
-- parent expense; this table stores the resolved monetary amount each member
-- owes regardless of strategy, making balance queries simple aggregations.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE expense_splits (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id   UUID          NOT NULL,
    user_id      UUID          NOT NULL,
    amount_owed  DECIMAL(12,2) NOT NULL,

    CONSTRAINT es_expense_fk FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE CASCADE,
    CONSTRAINT es_user_fk    FOREIGN KEY (user_id)    REFERENCES users    (id)
);

CREATE INDEX expense_splits_expense_id_idx ON expense_splits (expense_id);
CREATE INDEX expense_splits_user_id_idx    ON expense_splits (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: settlements
-- Records direct money transfers between two members (e.g. "Rohan paid Aisha
-- back ₹5000"). Settlements are intentionally separate from expenses to keep
-- balance calculations unambiguous.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE settlements (
    id        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id  UUID          NOT NULL,
    payer_id  UUID          NOT NULL,
    payee_id  UUID          NOT NULL,
    amount    DECIMAL(12,2) NOT NULL,
    date      DATE          NOT NULL,
    notes     TEXT,
    created_at TIMESTAMP    NOT NULL DEFAULT NOW(),

    CONSTRAINT stl_group_fk  FOREIGN KEY (group_id)  REFERENCES groups (id) ON DELETE CASCADE,
    CONSTRAINT stl_payer_fk  FOREIGN KEY (payer_id)  REFERENCES users  (id),
    CONSTRAINT stl_payee_fk  FOREIGN KEY (payee_id)  REFERENCES users  (id),

    -- A settlement amount must be strictly positive.
    CONSTRAINT stl_amount_positive CHECK (amount > 0)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: import_logs
-- Full audit trail of every row processed during a CSV import session.
-- session_id groups all rows from a single import run so the entire session
-- can be reviewed, replayed, or rolled back as a unit.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE import_logs (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID          NOT NULL,
    row_number   INT,
    raw_data     TEXT,
    anomaly_type VARCHAR(50),
    action_taken VARCHAR(50),
    status       import_status NOT NULL,
    created_at   TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX import_logs_session_id_idx ON import_logs (session_id);
