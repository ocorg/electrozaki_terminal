-- Add qty to transactions.
--
-- Why: accessories can be sold with quantity > 1 in a single POS cart line (phones/laptops
-- can't — they're unique serialized items). The transaction row records the correct total
-- price (unit_price * qty) but, without this column, the API has no way to know how many
-- units were actually sold — it always decremented accessory stock by exactly 1 regardless
-- of qty, silently overstating stock on every qty>1 sale that isn't later voided. Persisting
-- qty lets both the sale-time decrement and the void-time restore use the real quantity.
--
-- Existing rows default to 1, which matches what every past transaction has always
-- effectively assumed (the decrement/restore logic already hardcoded 1 unit).

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 1;
