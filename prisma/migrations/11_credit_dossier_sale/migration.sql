-- One credit system (owner, 2026-10-04): a phone paid in several times is a
-- real POS sale (figures, receipt, warranty, returns) followed by a credit
-- file (dossier: payments, schedule, reminders, reservation, discharge).
--   txn_id       the sale the file follows (NULL = old files made in the Phones module)
--   client_id    the client of that sale
--   avance_vente the down payment taken on the sale itself (it is in the sale,
--                so it is not a credit payment; montant_paye = avance_vente + payments)
ALTER TABLE "phone_credit_sales" ADD COLUMN "txn_id" TEXT;
ALTER TABLE "phone_credit_sales" ADD COLUMN "client_id" TEXT;
ALTER TABLE "phone_credit_sales" ADD COLUMN "avance_vente" DECIMAL(10,2) NOT NULL DEFAULT 0;
CREATE INDEX "idx_pcs_txn" ON "phone_credit_sales"("txn_id");
CREATE INDEX "idx_pcs_client" ON "phone_credit_sales"("client_id");

-- Client accounts: sales that have a file are followed in the file (same
-- rules as migration 10 otherwise).
CREATE OR REPLACE VIEW "public"."client_summary" AS
WITH pos_lines AS (
  SELECT ci.import_id, ci.client_id, ci.created_at, ci.montant_du, ci.montant_paye
  FROM credit_imports ci
  WHERE ci.client_id IS NOT NULL AND ci.notes LIKE 'POS —%' AND ci.statut <> 'annule'
),
sale_line AS (   -- each sale and the POS line of its checkout (if any)
  SELECT t.txn_id, t.client_id, t.prix_vente, t.avance, t.valeur_echange, t.payment_method,
         (SELECT pl.import_id FROM pos_lines pl
           WHERE pl.client_id = t.client_id
             AND pl.created_at >= t.created_at          -- the POS adds its line right after the checkout's last sale
             AND pl.created_at <= t.created_at + interval '5 minutes'
           ORDER BY pl.created_at LIMIT 1) AS import_id
  FROM transactions t
  WHERE t.voided = false AND t.client_id IS NOT NULL
    -- a sale followed by a credit file (dossier) is tracked there, not on the client's account
    AND NOT EXISTS (SELECT 1 FROM phone_credit_sales d WHERE d.txn_id = t.txn_id AND d.is_deleted = false)
),
checkout AS (    -- trade-in of each POS checkout
  SELECT s.import_id,
         CASE WHEN count(DISTINCT s.valeur_echange) FILTER (WHERE s.valeur_echange > 0) <= 1
              THEN COALESCE(max(s.valeur_echange), 0)
              ELSE COALESCE(sum(s.valeur_echange), 0) END AS echange
  FROM sale_line s WHERE s.import_id IS NOT NULL
  GROUP BY s.import_id
),
debt AS (
  SELECT pl.client_id, GREATEST(pl.montant_du - c.echange, 0) - pl.montant_paye AS amount
  FROM pos_lines pl JOIN checkout c ON c.import_id = pl.import_id
  UNION ALL
  SELECT s.client_id,
         CASE WHEN s.payment_method = 'echange' THEN 0
              WHEN s.payment_method = 'credit' THEN GREATEST(s.prix_vente - COALESCE(s.valeur_echange, 0), 0)
              WHEN s.avance > 0 THEN GREATEST(s.prix_vente - s.avance - COALESCE(s.valeur_echange, 0), 0)
              ELSE 0 END
  FROM sale_line s WHERE s.import_id IS NULL
  UNION ALL
  SELECT ci.client_id, ci.montant_du - ci.montant_paye
  FROM credit_imports ci
  WHERE ci.client_id IS NOT NULL AND ci.statut <> 'annule' AND (ci.notes IS NULL OR ci.notes NOT LIKE 'POS —%')
)
SELECT c.client_id,
    c.nom,
    c.telephone,
    c.telephone_2,
    c.email,
    c.adresse,
    c.date_premier_achat,
    c.notes,
    c.created_at,
    c.created_by,
    c.updated_at,
    c.updated_by,
    c.store_id,
    c.is_deleted,
    COALESCE(t.total_ca, 0::numeric) AS total_ca,
    GREATEST(COALESCE(d.total, 0::numeric) - COALESCE(cp.total_paid, 0::numeric), 0::numeric) AS solde_impaye,
    COALESCE(r.nb_reparations, 0::bigint) AS total_reparations
   FROM clients c
     LEFT JOIN ( SELECT transactions.client_id, sum(transactions.prix_vente) AS total_ca
           FROM transactions WHERE transactions.voided = false
          GROUP BY transactions.client_id) t ON t.client_id = c.client_id
     LEFT JOIN ( SELECT debt.client_id, sum(debt.amount) AS total FROM debt GROUP BY debt.client_id) d ON d.client_id = c.client_id
     LEFT JOIN ( SELECT credit_payments.client_id, sum(credit_payments.montant) AS total_paid
           FROM credit_payments GROUP BY credit_payments.client_id) cp ON cp.client_id = c.client_id
     LEFT JOIN ( SELECT reparations.client_id, count(*) AS nb_reparations
           FROM reparations WHERE reparations.is_deleted = false
          GROUP BY reparations.client_id) r ON r.client_id = c.client_id;
