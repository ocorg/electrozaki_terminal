-- Accessories sold in several colours (owner, 2026-10-29): each colour is its
-- own accessory with its own stock; the colours of one model share
-- groupe_couleur (the acc_id of the group's first accessory). The website
-- sync carries both to the site (colour buttons between the colours).
-- Additive: nullable columns and an index; existing rows keep null.
ALTER TABLE "accessories" ADD COLUMN "couleur" TEXT;
ALTER TABLE "accessories" ADD COLUMN "groupe_couleur" TEXT;
CREATE INDEX "idx_accessories_groupe_couleur" ON "accessories"("groupe_couleur");
