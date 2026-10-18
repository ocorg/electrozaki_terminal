-- Calling website customers back (owner, 2026-10-18): a parcel can't always
-- leave at once (the delivery company's rounds), so staff note when to call
-- the customer again. Kept in the ERP: the website's database belongs to the
-- storefront project. One line per web order; done_at = the call was made.
CREATE TABLE "web_order_followups" (
    "order_id"   TEXT NOT NULL,
    "relance_le" DATE NOT NULL,
    "note"       TEXT,
    "done_at"    TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    CONSTRAINT "web_order_followups_pkey" PRIMARY KEY ("order_id")
);
CREATE INDEX "idx_web_order_followups_due" ON "web_order_followups"("relance_le") WHERE "done_at" IS NULL;
