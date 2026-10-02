-- Credit sales: payment schedule (échéancier) with reminders (owner, 2026-10-02).
-- Each line is a planned date + amount. Payments cover the lines in date
-- order; only payments made after the plan was (re)built count, so the
-- plan stores the amount already paid when it was built (echeancier_base).
ALTER TABLE "phone_credit_sales" ADD COLUMN "echeancier_base" DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE TABLE "phone_credit_echeances" (
  "echeance_id"   UUID          NOT NULL DEFAULT gen_random_uuid(),
  "credit_id"     TEXT          NOT NULL,
  "date_echeance" DATE          NOT NULL,
  "montant"       DECIMAL(10,2) NOT NULL CHECK ("montant" > 0),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by"    UUID,
  CONSTRAINT "phone_credit_echeances_pkey" PRIMARY KEY ("echeance_id"),
  CONSTRAINT "phone_credit_echeances_credit_fkey" FOREIGN KEY ("credit_id") REFERENCES "phone_credit_sales"("credit_id") ON DELETE CASCADE
);
CREATE INDEX "idx_pce_credit_date" ON "phone_credit_echeances"("credit_id", "date_echeance");
