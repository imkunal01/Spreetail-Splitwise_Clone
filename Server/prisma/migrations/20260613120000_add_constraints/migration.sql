-- Partial unique index for group_memberships
CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_membership"
ON "group_memberships"("user_id", "group_id")
WHERE left_at IS NULL;

-- Constraint for group_memberships
ALTER TABLE "group_memberships" ADD CONSTRAINT "left_after_joined" CHECK (left_at IS NULL OR left_at >= joined_at);

-- Partial unique index for expenses
CREATE UNIQUE INDEX IF NOT EXISTS "unique_expense_import"
ON "expenses"("group_id", "imported_row_hash")
WHERE imported_row_hash IS NOT NULL;

-- Constraints for expenses
ALTER TABLE "expenses" ADD CONSTRAINT "amount_not_zero" CHECK (amount != 0);
ALTER TABLE "expenses" ADD CONSTRAINT "valid_exchange" CHECK (exchange_rate > 0);

-- Constraint for settlements
ALTER TABLE "settlements" ADD CONSTRAINT "amount_check" CHECK (amount > 0);
