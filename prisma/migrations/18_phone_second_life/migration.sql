-- A phone that comes back (owner, 2026-10-08): a phone sold long ago and taken
-- back as a trade-in starts a second life with a record of its own — the old
-- record keeps its sale, its purchase price and what its supplier was owed.
-- So the IMEI is no longer unique over all records, only over the phones the
-- shop holds: one record "in the shop" per IMEI (sold, The Void and deleted
-- records do not count).
DROP INDEX "phones_imei_key";
CREATE INDEX "idx_phones_imei" ON "phones"("imei");
CREATE UNIQUE INDEX "phones_imei_live_key" ON "phones"("imei")
  WHERE "imei" IS NOT NULL AND "is_deleted" = false AND "status" NOT IN ('vendu', 'void');
-- The record of the phone's previous life (NULL = first time in the shop)
ALTER TABLE "phones" ADD COLUMN "vie_precedente_id" TEXT;
CREATE INDEX "idx_phones_vie_precedente" ON "phones"("vie_precedente_id");
