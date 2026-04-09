-- Create pos_claims table
CREATE TABLE IF NOT EXISTS "pos_claims" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "claim_number"    TEXT NOT NULL UNIQUE,
    "sales_order_id"  TEXT NOT NULL REFERENCES "sales_orders"("id"),
    "claim_type"      TEXT NOT NULL DEFAULT 'RETURN',
    "reason_code"     TEXT NOT NULL,
    "reason_notes"    TEXT,
    "status"          TEXT NOT NULL DEFAULT 'SUBMITTED',
    "claimed_amount"  DECIMAL(15,2) NOT NULL DEFAULT 0,
    "approved_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "review_notes"    TEXT,
    "submitted_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at"     TIMESTAMP(3),
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "reviewed_by"     TEXT
);

CREATE INDEX IF NOT EXISTS "pos_claims_sales_order_id_idx" ON "pos_claims"("sales_order_id");
CREATE INDEX IF NOT EXISTS "pos_claims_status_idx" ON "pos_claims"("status");

-- Create pos_claim_items table
CREATE TABLE IF NOT EXISTS "pos_claim_items" (
    "id"                   TEXT NOT NULL PRIMARY KEY,
    "claim_id"             TEXT NOT NULL REFERENCES "pos_claims"("id") ON DELETE CASCADE,
    "sales_order_item_id"  TEXT NOT NULL,
    "item_id"              TEXT NOT NULL REFERENCES "Item"("id"),
    "claimed_qty"          INTEGER NOT NULL,
    "approved_qty"         INTEGER NOT NULL DEFAULT 0,
    "unit_paid_price"      DECIMAL(15,2) NOT NULL,
    "claimed_amount"       DECIMAL(15,2) NOT NULL,
    "approved_amount"      DECIMAL(15,2) NOT NULL DEFAULT 0,
    "item_status"          TEXT NOT NULL DEFAULT 'PENDING',
    "review_notes"         TEXT,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "pos_claim_items_claim_id_idx" ON "pos_claim_items"("claim_id");
CREATE INDEX IF NOT EXISTS "pos_claim_items_item_id_idx" ON "pos_claim_items"("item_id");
