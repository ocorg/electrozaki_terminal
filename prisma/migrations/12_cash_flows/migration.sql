-- Cash really leaving / entering the drawer (owner, 2026-10-04).
-- 1. A supplier payment says where the money came from: the day's drawer
--    ('caisse' — it then leaves the day's caisse), cash from elsewhere
--    ('hors_caisse': safe, personal) or a bank transfer ('virement').
--    Past payments stay out of the caisse.
ALTER TABLE "supplier_payments" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'hors_caisse'
  CONSTRAINT "supplier_payments_source_check" CHECK ("source" IN ('caisse', 'hors_caisse', 'virement'));
ALTER TABLE "caisse" ADD COLUMN "total_fournisseurs" DECIMAL(10,2) DEFAULT 0;

-- 2. A catch-all service item for the POS "Service" entry (a quick repair or
--    service that isn't one of the listed ones): label typed, price typed.
INSERT INTO "accessories" ("nom", "categorie", "quantite", "seuil_alerte", "store_id")
SELECT 'Service divers', 'service', 0, 0, 'EZ-001'
WHERE NOT EXISTS (SELECT 1 FROM "accessories" WHERE "nom" = 'Service divers' AND "categorie" = 'service');
