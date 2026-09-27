-- Suppliers: one logic for every category (owner's decision, 2026-09-28).
-- The "A" logic for all: a supplier is owed a phone only once it is SOLD
-- (the cash received for it: invoice minus trade-in, else its purchase
-- price); paying = settling the chosen sold phones. Every payment counts;
-- what was paid beyond the phones settled (advances, a payment made before
-- the sales) is a credit, deducted from what is left to pay.
-- Categories A/B/C/D stay as labels only. "Electro Zaki" (our own stock) is
-- shown for information with the same calculation.

-- 1. B-style payments listed the phones they paid, without settling them:
--    settle them now (so they leave the "to pay" list).
UPDATE "phones" p
SET "settled_at" = sp."created_at", "settled_by" = sp."created_by"
FROM "supplier_payments" sp
WHERE NOT sp."is_deleted"
  AND sp."payment_type" = 'paiement_b'
  AND p."phone_id" = ANY (sp."phone_ids")
  AND p."status" = 'vendu'
  AND p."settled_at" IS NULL;

-- 2. Same balance calculation for every supplier.
DROP VIEW IF EXISTS "public"."suppliers_summary";
CREATE VIEW "public"."suppliers_summary" AS
SELECT s.supplier_id, s.nom, s.telephone, s.email, s.adresse, s.ville, s.categorie, s.type_fournisseur,
       s.notes, s.created_at, s.created_by, s.updated_at, s.updated_by, s.store_id, s.is_deleted,
       st.nb_en_stock,
       st.nb_vendus,
       st.total_achats,
       pay.total_paye,
       -- left to pay = sold phones not settled − the credit
       GREATEST(v.non_regle - GREATEST(pay.total_paye - v.regle, 0), 0)                AS solde_du,
       v.regle                                                                          AS a_montant_vendu_regle,
       st.en_stock                                                                      AS a_montant_en_stock,
       v.non_regle                                                                      AS montant_vendu_non_regle,
       v.nb_non_regle                                                                   AS nb_a_regler,
       -- credit = everything paid beyond the phones settled (advances, overpayments)
       GREATEST(pay.total_paye - v.regle, 0)                                            AS credit_total,
       -- credit still available once the sold phones waiting are covered
       GREATEST(GREATEST(pay.total_paye - v.regle, 0) - v.non_regle, 0)                 AS credit_disponible
FROM "public"."suppliers" s
LEFT JOIN LATERAL (
  SELECT (count(*) FILTER (WHERE p.status = 'disponible'))::integer                     AS nb_en_stock,
         (count(*) FILTER (WHERE p.status = 'vendu'))::integer                          AS nb_vendus,
         COALESCE(sum(p.prix_achat), 0)                                                 AS total_achats,
         COALESCE(sum(p.prix_achat) FILTER (WHERE p.status = 'disponible'), 0)          AS en_stock
  FROM "public"."phones" p
  WHERE p.fournisseur_id = s.supplier_id AND NOT p.is_deleted
) st ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(sp.montant), 0) AS total_paye
  FROM "public"."supplier_payments" sp
  WHERE sp.supplier_id = s.supplier_id AND NOT sp.is_deleted
) pay ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(x.cash) FILTER (WHERE x.settled), 0)      AS regle,
         COALESCE(sum(x.cash) FILTER (WHERE NOT x.settled), 0)  AS non_regle,
         (count(*) FILTER (WHERE NOT x.settled))::integer        AS nb_non_regle
  FROM (
    SELECT p.settled_at IS NOT NULL AS settled,
           CASE WHEN fac.doc_id IS NOT NULL THEN GREATEST(fac.montant - COALESCE(ech.montant, 0), 0)
                ELSE COALESCE(p.prix_achat, 0) END AS cash
    FROM "public"."phones" p
    LEFT JOIN LATERAL (
      SELECT d.doc_id, d.montant, d.doc_ref FROM "public"."ez_documents" d
      WHERE d.phone_id = p.phone_id AND d.doc_type = 'FAC' ORDER BY d.created_at DESC LIMIT 1
    ) fac ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(d.montant), 0) AS montant FROM "public"."ez_documents" d
      WHERE d.doc_type = 'ECH' AND d.linked_doc_ref = fac.doc_ref
    ) ech ON fac.doc_id IS NOT NULL
    WHERE p.fournisseur_id = s.supplier_id AND p.status = 'vendu' AND NOT p.is_deleted
  ) x
) v ON true
WHERE NOT s.is_deleted;
