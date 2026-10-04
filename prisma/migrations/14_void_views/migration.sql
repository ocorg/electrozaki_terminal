-- A phone in "The Void" was had from its supplier all the same: he is owed
-- for it exactly like a sold phone (views of migration 9, with 'void').
CREATE OR REPLACE VIEW "public"."phones_unsettled_a" AS
SELECT p.phone_id,
    p.fournisseur_id,
    p.store_id,
    p.marque,
    p.model,
    p.imei,
    p.couleur,
    p.stockage,
    p.prix_achat,
    p.updated_at AS sold_at,
        CASE
            WHEN fac.doc_id IS NOT NULL THEN GREATEST(fac.montant - COALESCE(ech.montant, 0::numeric), 0::numeric)
            ELSE COALESCE(p.du_fournisseur, p.prix_achat, 0::numeric)
        END AS cash_recu,
    fac.doc_ref AS fac_ref,
    fac.montant AS fac_montant,
    COALESCE(ech.montant, 0::numeric) AS ech_montant,
    p.origine_phone_id
   FROM phones p
     LEFT JOIN LATERAL ( SELECT ez_documents.doc_id,
            ez_documents.montant,
            ez_documents.doc_ref
           FROM ez_documents
          WHERE ez_documents.phone_id = p.phone_id AND ez_documents.doc_type = 'FAC'::text
          ORDER BY ez_documents.created_at DESC
         LIMIT 1) fac ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(ez_documents.montant), 0::numeric) AS montant
           FROM ez_documents
          WHERE ez_documents.doc_type = 'ECH'::text AND ez_documents.linked_doc_ref = fac.doc_ref) ech ON fac.doc_id IS NOT NULL
  WHERE p.status IN ('vendu'::device_status, 'void'::device_status) AND p.settled_at IS NULL AND p.is_deleted = false;

-- Same balance calculation as migration 9.
DROP VIEW IF EXISTS "public"."suppliers_summary";
CREATE VIEW "public"."suppliers_summary" AS
SELECT s.supplier_id, s.nom, s.telephone, s.email, s.adresse, s.ville, s.categorie, s.type_fournisseur,
       s.notes, s.created_at, s.created_by, s.updated_at, s.updated_by, s.store_id, s.is_deleted,
       st.nb_en_stock,
       st.nb_vendus,
       st.total_achats,
       pay.total_paye,
       GREATEST(v.non_regle - GREATEST(pay.total_paye - v.regle, 0), 0)                AS solde_du,
       v.regle                                                                          AS a_montant_vendu_regle,
       st.en_stock                                                                      AS a_montant_en_stock,
       v.non_regle                                                                      AS montant_vendu_non_regle,
       v.nb_non_regle                                                                   AS nb_a_regler,
       GREATEST(pay.total_paye - v.regle, 0)                                            AS credit_total,
       GREATEST(GREATEST(pay.total_paye - v.regle, 0) - v.non_regle, 0)                 AS credit_disponible
FROM "public"."suppliers" s
LEFT JOIN LATERAL (
  SELECT (count(*) FILTER (WHERE p.status = 'disponible'))::integer                     AS nb_en_stock,
         (count(*) FILTER (WHERE p.status IN ('vendu', 'void')))::integer               AS nb_vendus,
         -- what was bought from him (trade-ins that joined his account aren't purchases)
         COALESCE(sum(p.prix_achat) FILTER (WHERE p.origine_phone_id IS NULL), 0)       AS total_achats,
         COALESCE(sum(COALESCE(p.du_fournisseur, p.prix_achat)) FILTER (WHERE p.status = 'disponible'), 0) AS en_stock
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
                ELSE COALESCE(p.du_fournisseur, p.prix_achat, 0) END AS cash
    FROM "public"."phones" p
    LEFT JOIN LATERAL (
      SELECT d.doc_id, d.montant, d.doc_ref FROM "public"."ez_documents" d
      WHERE d.phone_id = p.phone_id AND d.doc_type = 'FAC' ORDER BY d.created_at DESC LIMIT 1
    ) fac ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(d.montant), 0) AS montant FROM "public"."ez_documents" d
      WHERE d.doc_type = 'ECH' AND d.linked_doc_ref = fac.doc_ref
    ) ech ON fac.doc_id IS NOT NULL
    WHERE p.fournisseur_id = s.supplier_id AND p.status IN ('vendu', 'void') AND NOT p.is_deleted
  ) x
) v ON true
WHERE NOT s.is_deleted;
