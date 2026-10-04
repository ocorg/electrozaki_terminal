-- "The Void" (owner, 2026-10-04): a status of its own for a phone that left
-- the stock with no sale to record — sold but nobody remembers to whom or
-- when, or taken apart for its parts. Not in stock, not a sale; its
-- purchase price is a loss, and its supplier is still owed (next migration).
ALTER TYPE "device_status" ADD VALUE IF NOT EXISTS 'void';
ALTER TABLE "phones" ADD COLUMN "void_at" TIMESTAMPTZ(6);
ALTER TABLE "phones" ADD COLUMN "void_by" UUID;
ALTER TABLE "phones" ADD COLUMN "void_motif" TEXT;
