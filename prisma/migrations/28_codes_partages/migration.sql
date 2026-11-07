-- One box code shared by several articles (owner, 2026-11-07): some
-- suppliers print the same code on different products (prices may differ).
-- The code can now belong to several articles; scanning it asks which one.
ALTER TABLE accessory_codes DROP CONSTRAINT accessory_codes_pkey;
ALTER TABLE accessory_codes ADD PRIMARY KEY (code, acc_id);
CREATE INDEX idx_accessory_codes_code ON accessory_codes (code);
