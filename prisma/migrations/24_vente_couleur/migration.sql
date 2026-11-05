-- The colour (and design) of the accessory sold (owner, 2026-11-06): chosen at
-- the till in a colour popup, so the sales already say which colour went out
-- before stock is counted per colour. Additive: empty for every past sale.
-- The colour comes from the colour list; a renamed colour follows.
ALTER TABLE transactions ADD COLUMN couleur TEXT REFERENCES couleurs(nom) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE transactions ADD COLUMN design TEXT;
ALTER TABLE delivery_items ADD COLUMN couleur TEXT REFERENCES couleurs(nom) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE delivery_items ADD COLUMN design TEXT;
