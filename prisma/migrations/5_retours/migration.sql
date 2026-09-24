-- Returns v2: a return is a refund dated the day it happens (the original
-- sale and its closed caisse stay untouched), with partial quantities, a
-- destination for the item and store credit (avoir) spent on a later sale.

CREATE SEQUENCE "public"."retours_seq" START WITH 1 INCREMENT BY 1;

-- CreateEnum
CREATE TYPE "retour_mode" AS ENUM ('especes', 'virement', 'avoir');

-- CreateEnum
CREATE TYPE "retour_destination" AS ENUM ('stock', 'reparation', 'defectueux');

-- CreateEnum
CREATE TYPE "retour_type" AS ENUM ('retour', 'solde_avoir');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "avoir_montant" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "avoir_retour_id" TEXT;

-- CreateTable
CREATE TABLE "retours" (
    "retour_id" TEXT NOT NULL DEFAULT ('RET-'::text || lpad((nextval('retours_seq'::regclass))::text, 4, '0'::text)),
    "type" "retour_type" NOT NULL DEFAULT 'retour',
    "txn_id" TEXT NOT NULL,
    "avoir_id" TEXT,
    "store_id" TEXT,
    "date" DATE NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "montant" DECIMAL(10,2) NOT NULL,
    "mode" "retour_mode" NOT NULL,
    "destination" "retour_destination",
    "motif" TEXT NOT NULL,
    "avoir_solde" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "retours_pkey" PRIMARY KEY ("retour_id")
);

-- CreateIndex
CREATE INDEX "retours_txn_id_idx" ON "retours"("txn_id");

-- CreateIndex
CREATE INDEX "retours_store_id_date_idx" ON "retours"("store_id", "date");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_avoir_retour_id_fkey" FOREIGN KEY ("avoir_retour_id") REFERENCES "retours"("retour_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "retours" ADD CONSTRAINT "retours_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "transactions"("txn_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "retours" ADD CONSTRAINT "retours_avoir_id_fkey" FOREIGN KEY ("avoir_id") REFERENCES "retours"("retour_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

