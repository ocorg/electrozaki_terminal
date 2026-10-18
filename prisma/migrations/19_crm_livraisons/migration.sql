-- CRM and sales to deliver (owner, 2026-10-18).
--
-- 1. Leads: every conversation started on a social network (Instagram,
--    WhatsApp Business, TikTok, Facebook…), entered by hand by a manager,
--    followed to its outcome (won: the sale, the delivery or the phone bought
--    from them; lost: why). Leads waiting for stock are the shop's list of
--    people to contact when what they want comes in. Replaces Prospects.
-- 2. Deliveries become orders: the POS creates the card with its items and
--    prices; the advance arrives by bank transfer, the rest is collected by
--    the delivery company and paid into the shop's account. The sale is
--    recorded when the parcel is delivered; a refused parcel goes back to
--    stock and was never a sale.

CREATE TYPE "lead_canal"  AS ENUM ('instagram', 'whatsapp', 'tiktok', 'facebook', 'appel', 'site', 'magasin', 'autre');
CREATE TYPE "lead_type"   AS ENUM ('achat', 'vente', 'reprise', 'autre');
CREATE TYPE "lead_etape"  AS ENUM ('nouveau', 'en_discussion', 'proposition', 'attente_stock', 'gagne', 'perdu');
CREATE TYPE "lead_motif"  AS ENUM ('prix', 'pas_en_stock', 'achete_ailleurs', 'sans_reponse', 'curieux', 'refus_livraison', 'autre');

CREATE SEQUENCE "leads_seq";
CREATE SEQUENCE "lead_notes_seq";

CREATE TABLE "leads" (
    "lead_id"        TEXT NOT NULL DEFAULT ('LEAD-' || lpad(nextval('leads_seq')::text, 4, '0')),
    "store_id"       TEXT NOT NULL,
    "canal"          "lead_canal" NOT NULL,
    "nom"            TEXT,
    "pseudo"         TEXT,                -- @name on Instagram / TikTok / Facebook
    "telephone"      TEXT,
    "client_id"      TEXT,
    "type_demande"   "lead_type" NOT NULL DEFAULT 'achat',
    "etape"          "lead_etape" NOT NULL DEFAULT 'nouveau',
    "motif_perte"    "lead_motif",
    -- what they want (achat, reprise)
    "cherche"        TEXT,                -- 'telephone' | 'accessoire'
    "marque"         TEXT,                -- one or several brands, "Apple, Samsung"
    "model"          TEXT,
    "stockage"       TEXT,
    "budget_min"     DECIMAL(10,2),
    "budget_max"     DECIMAL(10,2),
    "accessoire"     TEXT,
    -- their phone (vente, reprise)
    "leur_marque"    TEXT,
    "leur_model"     TEXT,
    "leur_stockage"  TEXT,
    "leur_batterie"  INTEGER,
    "leur_etat"      TEXT,
    "leur_pieces"    TEXT,
    "prix_demande"   DECIMAL(10,2),
    "prix_propose"   DECIMAL(10,2),
    "details"        TEXT,
    "relance_le"     DATE,
    -- outcome
    "txn_id"         TEXT,                -- won in the shop: the POS sale
    "delivery_id"    TEXT,                -- won by delivery: the order
    "phone_id"       TEXT,                -- vente: the phone bought from them
    "montant"        DECIMAL(10,2),       -- what the won lead brought (sale) or cost (phone bought)
    "closed_at"      TIMESTAMPTZ(6),
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"     UUID,
    "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by"     UUID,
    "is_deleted"     BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "leads_pkey" PRIMARY KEY ("lead_id")
);
CREATE INDEX "idx_leads_store_etape" ON "leads"("store_id", "etape");
CREATE INDEX "idx_leads_telephone"   ON "leads"("telephone");
CREATE INDEX "idx_leads_relance"     ON "leads"("relance_le");

CREATE TABLE "lead_notes" (
    "note_id"    TEXT NOT NULL DEFAULT ('LNT-' || lpad(nextval('lead_notes_seq')::text, 5, '0')),
    "lead_id"    TEXT NOT NULL,
    "texte"      TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("note_id"),
    CONSTRAINT "lead_notes_lead_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("lead_id") ON DELETE CASCADE
);
CREATE INDEX "idx_lead_notes_lead" ON "lead_notes"("lead_id");

-- Deliveries as orders
ALTER TABLE "deliveries" ADD COLUMN "ville"             TEXT;
ALTER TABLE "deliveries" ADD COLUMN "transporteur"      TEXT;
ALTER TABLE "deliveries" ADD COLUMN "frais_livraison"   DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "deliveries" ADD COLUMN "frais_charge"      TEXT NOT NULL DEFAULT 'client';   -- 'client' | 'boutique'
ALTER TABLE "deliveries" ADD COLUMN "avance_ref"        TEXT;
ALTER TABLE "deliveries" ADD COLUMN "avance_date"       DATE;
ALTER TABLE "deliveries" ADD COLUMN "date_livraison"    DATE;
ALTER TABLE "deliveries" ADD COLUMN "versement_recu_at" TIMESTAMPTZ(6);                   -- the company paid the shop
ALTER TABLE "deliveries" ADD COLUMN "avance_decision"   TEXT;                             -- refused: 'remboursee' | 'gardee'
ALTER TABLE "deliveries" ADD COLUMN "motif_retour"      TEXT;
ALTER TABLE "deliveries" ADD COLUMN "lead_id"           TEXT;
ALTER TABLE "deliveries" ADD COLUMN "commande"          BOOLEAN NOT NULL DEFAULT false;   -- created by the POS (sale on delivery)

ALTER TABLE "delivery_items" ADD COLUMN "qty"             INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "delivery_items" ADD COLUMN "prix_vente"      DECIMAL(10,2);
ALTER TABLE "delivery_items" ADD COLUMN "override_by"     UUID;
ALTER TABLE "delivery_items" ADD COLUMN "override_reason" TEXT;

-- Prospects move into the CRM: what they asked for, kept for when it comes in
INSERT INTO "leads" ("store_id", "canal", "nom", "telephone", "type_demande", "etape", "cherche", "marque", "model",
                     "stockage", "budget_min", "budget_max", "details", "created_at", "created_by", "updated_at")
SELECT p."store_id",
       CASE p."source"::text WHEN 'en_magasin' THEN 'magasin' WHEN 'autre' THEN 'autre' ELSE p."source"::text END::"lead_canal",
       p."nom", p."telephone", 'achat',
       CASE p."statut"::text WHEN 'contacte' THEN 'en_discussion' WHEN 'converti' THEN 'gagne' WHEN 'perdu' THEN 'perdu' ELSE 'attente_stock' END::"lead_etape",
       'telephone', p."marque", p."model", p."stockage", p."budget_min", p."budget_max", p."notes",
       COALESCE(p."created_at", CURRENT_TIMESTAMP),
       CASE WHEN p."created_by" ~ '^[0-9a-f-]{36}$' THEN p."created_by"::uuid END,
       COALESCE(p."updated_at", CURRENT_TIMESTAMP)
FROM "prospects" p
WHERE NOT COALESCE(p."is_deleted", false);
