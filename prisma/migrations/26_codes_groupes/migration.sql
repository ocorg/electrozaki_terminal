-- Accessory codes and phone groups (owner, 2026-11-07):
-- 1. A variant covers a GROUP of phone models sharing one stock (a glass for
--    iPhone 13 / 14 / 15): modele (one phone) becomes modeles (a list).
ALTER TABLE accessory_variants ADD COLUMN modeles TEXT[] NOT NULL DEFAULT '{}';
UPDATE accessory_variants SET modeles = ARRAY[modele] WHERE modele IS NOT NULL;
DROP INDEX accessory_variants_one;
ALTER TABLE accessory_variants DROP COLUMN modele;

-- 2. Every code that finds an accessory: the manufacturer's codes on boxes
--    and sachets (several per article, learned when first scanned), each
--    pointing at the article or straight at one of its variants. The
--    article's own code (accessories.barcode, EZ-ACC-…) still works too.
CREATE TABLE accessory_codes (
  code       TEXT PRIMARY KEY,
  acc_id     TEXT NOT NULL REFERENCES accessories(acc_id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES accessory_variants(variant_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);
CREATE INDEX idx_accessory_codes_acc ON accessory_codes (acc_id);

-- 3. The exact variant a sale took its piece from (a scanned group label
--    says no phone model): a return puts the piece back there.
ALTER TABLE transactions ADD COLUMN variant_id TEXT;
ALTER TABLE delivery_items ADD COLUMN variant_id TEXT;
