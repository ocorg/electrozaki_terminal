-- A phone ordered for a client who paid an advance (owner, 2026-10-30): the
-- record exists before the phone does (sold "Plusieurs fois", reserved), its
-- IMEI is typed when it arrives. Kept out of stock counts and inventories.
-- Additive: a boolean defaulting to false; existing phones are not ordered.
ALTER TABLE "phones" ADD COLUMN "en_commande" BOOLEAN NOT NULL DEFAULT false;
