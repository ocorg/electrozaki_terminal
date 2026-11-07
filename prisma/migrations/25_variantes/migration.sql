-- Stock per variant (owner, 2026-11-06, step 4 of the accessories redesign):
-- one article (a pochette family, SpaceBuds 2…) counted per design × colour ×
-- phone model. The article's quantite stays its whole stock; the pieces not
-- yet counted per variant are the "non réparti" ones (quantite − Σ variants).
-- A sale with a chosen variant takes from it, a return puts it back.
CREATE SEQUENCE accessory_variants_seq;
CREATE TABLE accessory_variants (
  variant_id TEXT PRIMARY KEY DEFAULT ('VAR-' || lpad(nextval('accessory_variants_seq')::text, 6, '0')),
  acc_id     TEXT NOT NULL REFERENCES accessories(acc_id) ON DELETE CASCADE,
  design     TEXT,
  couleur    TEXT REFERENCES couleurs(nom) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- the phone model it is made for (name from the ERP phone list), e.g. "iPhone 15 Pro"
  modele     TEXT,
  quantite   INT NOT NULL DEFAULT 0 CHECK (quantite >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one line per design × colour × model of an article
CREATE UNIQUE INDEX accessory_variants_one ON accessory_variants (acc_id, coalesce(design, ''), coalesce(couleur, ''), coalesce(modele, ''));
CREATE INDEX idx_accessory_variants_acc ON accessory_variants (acc_id);

-- the phone model of the accessory sold (with its colour and design, migration 24)
ALTER TABLE transactions ADD COLUMN modele TEXT;
ALTER TABLE delivery_items ADD COLUMN modele TEXT;
