-- Accessory stock count (owner, 2026-11-07, step 4 of the codes plan): a
-- count of some or all accessory types. A scan adds 1 to its line (an
-- article, or one of its variants), a naked product gets its number typed.
-- At the end the gaps with the stock are listed and a manager applies them.
CREATE TABLE acc_counts (
  count_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    TEXT NOT NULL,
  -- accessory types counted (categories.code); empty = all
  categories  TEXT[] NOT NULL DEFAULT '{}',
  statut      TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'appliquee', 'annulee')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ,
  created_by  UUID,
  closed_by   UUID
);
-- one count open at a time per store
CREATE UNIQUE INDEX acc_counts_one_open ON acc_counts (store_id) WHERE statut = 'en_cours';

CREATE TABLE acc_count_lines (
  count_id   UUID NOT NULL REFERENCES acc_counts(count_id) ON DELETE CASCADE,
  acc_id     TEXT NOT NULL REFERENCES accessories(acc_id) ON DELETE CASCADE,
  -- the variant counted; '-' = the article itself (or its pieces without a variant)
  line_key   TEXT NOT NULL DEFAULT '-',
  counted    INT NOT NULL DEFAULT 0 CHECK (counted >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  PRIMARY KEY (count_id, acc_id, line_key)
);
