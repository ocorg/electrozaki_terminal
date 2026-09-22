-- Baseline ported from Supabase (public schema).
-- Tables/indexes/FKs come from schema.prisma; everything below that Prisma
-- can't express (sequences, CHECKs, functions, triggers, views) is copied
-- verbatim from the Supabase catalog. Supabase-only pieces (auth.users FKs,
-- RLS policies, auth.uid() helpers) are intentionally not ported.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sequences
CREATE SEQUENCE "public"."accessories_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."activity_log_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."attendance_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."caisse_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."changelog_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."clients_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."credit_imports_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."credit_payments_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."deliveries_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."delivery_items_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."expenses_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."ez_doc_id_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."ez_ech_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."ez_fac_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."ez_rch_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."ez_rst_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."ez_sav_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."laptops_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."movements_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."parts_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."payments_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."phone_catalog_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."phone_credit_payments_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."phone_credit_sales_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."phones_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."repairs_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."supplier_payments_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."suppliers_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."transactions_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "public"."warranty_events_seq" START WITH 1 INCREMENT BY 1;

-- Functions
CREATE OR REPLACE FUNCTION public.confirm_document_sale(p_doc_id text, p_phone_id text, p_facture_ref text, p_prix_vente numeric, p_payment_method text, p_date_vente date, p_warranty_start date, p_warranty_expiry date, p_client_id text, p_store_id text, p_created_by uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  new_txn_id  TEXT;
BEGIN

  -- 1. Create the transaction record
  INSERT INTO transactions (
    device_type,
    device_id,
    client_id,
    type_operation,
    prix_vente,
    date_vente,
    payment_method,
    warranty_start,
    warranty_expiry,
    facture_ref,
    store_id,
    created_by,
    notes
  )
  VALUES (
    'phone',
    p_phone_id,
    p_client_id,
    'Vente',
    p_prix_vente,
    p_date_vente,
    p_payment_method::text,
    p_warranty_start,
    p_warranty_expiry,
    p_facture_ref,
    p_store_id,
    p_created_by,
    p_notes
  )
  RETURNING txn_id INTO new_txn_id;

  -- 2. Mark the phone as sold
  UPDATE phones
  SET
    status     = 'مباع',
    updated_at = NOW(),
    updated_by = p_created_by
  WHERE phone_id = p_phone_id;

  -- 3. Link the document to the new transaction
  UPDATE ez_documents
  SET
    txn_id     = new_txn_id,
    printed_at = NOW()
  WHERE doc_id = p_doc_id;

  RETURN jsonb_build_object(
    'success', true,
    'txn_id',  new_txn_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_store_id text)
 RETURNS TABLE(ca_today numeric, nb_ventes_today bigint, ca_month numeric, nb_ventes_month bigint, total_credit_open numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(t.prix_vente) FILTER (
      WHERE t.date_vente = CURRENT_DATE AND NOT t.voided
    ), 0),
    COUNT(*) FILTER (
      WHERE t.date_vente = CURRENT_DATE AND NOT t.voided
    ),
    COALESCE(SUM(t.prix_vente) FILTER (
      WHERE date_trunc('month', t.date_vente) = date_trunc('month', CURRENT_DATE)
        AND NOT t.voided
    ), 0),
    COUNT(*) FILTER (
      WHERE date_trunc('month', t.date_vente) = date_trunc('month', CURRENT_DATE)
        AND NOT t.voided
    ),
    COALESCE((
      SELECT SUM(t2.avance)
      FROM transactions t2
      WHERE t2.store_id = p_store_id
        AND t2.avance > 0
        AND NOT t2.voided
    ), 0)
  FROM transactions t
  WHERE t.store_id = p_store_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_effective_warranty_expiry(p_txn_id text)
 RETURNS date
 LANGUAGE plpgsql
AS $function$
DECLARE
  base_expiry      DATE;
  total_extension  INTEGER := 0;
  ev               RECORD;
  open_date        DATE := NULL;
BEGIN
  -- Base expiry from the original transaction
  SELECT warranty_expiry INTO base_expiry
  FROM transactions
  WHERE txn_id = p_txn_id;

  IF base_expiry IS NULL THEN
    RETURN NULL;
  END IF;

  -- Iterate events in chronological order and pair OPEN→CLOSE
  FOR ev IN
    SELECT event_type, event_date
    FROM warranty_events
    WHERE txn_id = p_txn_id
    ORDER BY event_date ASC, event_type ASC
  LOOP
    IF ev.event_type = 'SAV_OPEN' THEN
      open_date := ev.event_date;

    ELSIF ev.event_type = 'SAV_CLOSE' AND open_date IS NOT NULL THEN
      -- Add the number of days the phone was held
      total_extension := total_extension + (ev.event_date - open_date);
      open_date := NULL;
    END IF;
  END LOOP;

  -- If there is an open SAV with no close yet, no extension is added yet
  -- (it will be added once the SAV_CLOSE is recorded)

  RETURN base_expiry + total_extension;
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_credit_id()
 RETURNS text
 LANGUAGE sql
AS $function$
  SELECT 'CRD-' || LPAD(nextval('phone_credit_sales_seq')::TEXT, 4, '0');
$function$;

CREATE OR REPLACE FUNCTION public.next_credit_payment_id()
 RETURNS text
 LANGUAGE sql
AS $function$
  SELECT 'CPY-' || LPAD(nextval('phone_credit_payments_seq')::TEXT, 4, '0');
$function$;

CREATE OR REPLACE FUNCTION public.next_doc_ref(prefix text, seq_name text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  n   INTEGER;
  yr  TEXT;
BEGIN
  EXECUTE format('SELECT nextval(%L)', seq_name) INTO n;
  yr := to_char(NOW() AT TIME ZONE 'Africa/Casablanca', 'YYYY');
  RETURN prefix || '-' || yr || '-' || lpad(n::text, 6, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_accessory_barcode()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.barcode IS NULL THEN
    NEW.barcode = NEW.acc_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_credit_import_balance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_paye     NUMERIC;
  v_total    NUMERIC;
  v_statut   TEXT;
BEGIN
  SELECT COALESCE(SUM(montant), 0) INTO v_paye
  FROM credit_import_payments
  WHERE import_id = NEW.import_id;

  SELECT montant_du INTO v_total
  FROM credit_imports
  WHERE import_id = NEW.import_id;

  v_statut := CASE WHEN v_paye >= v_total THEN 'soldé' ELSE 'en_cours' END;

  UPDATE credit_imports
  SET montant_paye = v_paye,
      statut       = v_statut
  WHERE import_id  = NEW.import_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_override_pin(p_pin text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM user_profiles
  WHERE role IN ('manager', 'owner')
    AND is_active = TRUE
    AND override_pin = crypt(p_pin, override_pin)
  LIMIT 1;
  RETURN v_user_id; -- NULL if no match
END;
$function$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('staff', 'manager', 'owner');

-- CreateTable
CREATE TABLE "accessories" (
    "acc_id" TEXT NOT NULL DEFAULT ('EZ-ACC-'::text || lpad((nextval('accessories_seq'::regclass))::text, 6, '0'::text)),
    "barcode" TEXT,
    "nom" TEXT NOT NULL,
    "categorie" TEXT NOT NULL,
    "marque" TEXT,
    "compatible_with" TEXT,
    "prix_achat" DECIMAL(10,2),
    "prix_vente_recommande" DECIMAL(10,2),
    "prix_vente_minimum" DECIMAL(10,2),
    "quantite" INTEGER NOT NULL DEFAULT 0,
    "seuil_alerte" INTEGER NOT NULL DEFAULT 5,
    "fournisseur_id" TEXT,
    "location" TEXT NOT NULL DEFAULT 'Magasin Principal',
    "image_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "store_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "accessories_pkey" PRIMARY KEY ("acc_id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "log_id" TEXT NOT NULL DEFAULT ('LOG-'::text || lpad((nextval('activity_log_seq'::regclass))::text, 6, '0'::text)),
    "store_id" TEXT,
    "user_id" UUID,
    "user_name" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "record_id" TEXT,
    "before_state" JSONB,
    "after_state" JSONB,
    "ip_address" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "caisse" (
    "caisse_id" TEXT NOT NULL DEFAULT ('CAI-'::text || lpad((nextval('caisse_seq'::regclass))::text, 4, '0'::text)),
    "date" DATE NOT NULL,
    "ouverture" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_ventes" DECIMAL(10,2) DEFAULT 0,
    "total_reparations" DECIMAL(10,2) DEFAULT 0,
    "total_depenses" DECIMAL(10,2) DEFAULT 0,
    "solde_theorique" DECIMAL(10,2) DEFAULT 0,
    "solde_reel" DECIMAL(10,2),
    "ecart" DECIMAL(10,2),
    "payment_breakdown" JSONB,
    "notes" TEXT,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "store_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "eod_submitted_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejection_note" TEXT,
    "total_cash_drops" DECIMAL DEFAULT 0,

    CONSTRAINT "caisse_pkey" PRIMARY KEY ("caisse_id")
);

-- CreateTable
CREATE TABLE "cash_drops" (
    "drop_id" TEXT NOT NULL DEFAULT ((('DRP-'::text || to_char(now(), 'YYYYMMDD'::text)) || '-'::text) || upper(substr((gen_random_uuid())::text, 1, 6))),
    "store_id" TEXT,
    "amount" DECIMAL NOT NULL,
    "reason" TEXT NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "cash_drops_pkey" PRIMARY KEY ("drop_id")
);

-- CreateTable
CREATE TABLE "clients" (
    "client_id" TEXT NOT NULL DEFAULT ('CLI-'::text || lpad((nextval('clients_seq'::regclass))::text, 4, '0'::text)),
    "nom" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "telephone_2" TEXT,
    "email" TEXT,
    "adresse" TEXT,
    "date_premier_achat" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "store_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("client_id")
);

-- CreateTable
CREATE TABLE "credit_import_payments" (
    "payment_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_id" TEXT NOT NULL,
    "store_id" TEXT,
    "montant" DECIMAL(12,2) NOT NULL,
    "payment_method" TEXT NOT NULL DEFAULT 'نقد',
    "payment_ref" TEXT,
    "notes" TEXT,
    "date_paiement" DATE NOT NULL DEFAULT CURRENT_DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "credit_import_payments_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "credit_imports" (
    "import_id" TEXT NOT NULL DEFAULT ('CRIMP-'::text || lpad((nextval('credit_imports_seq'::regclass))::text, 4, '0'::text)),
    "client_id" TEXT,
    "client_name_free" TEXT,
    "client_phone_free" TEXT,
    "store_id" TEXT,
    "montant_du" DECIMAL NOT NULL,
    "description" TEXT,
    "date_origine" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "montant_paye" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "statut" TEXT NOT NULL DEFAULT 'en_cours',

    CONSTRAINT "credit_imports_pkey" PRIMARY KEY ("import_id")
);

-- CreateTable
CREATE TABLE "credit_payments" (
    "payment_id" TEXT NOT NULL DEFAULT ('CRPMT-'::text || lpad((nextval('credit_payments_seq'::regclass))::text, 4, '0'::text)),
    "client_id" TEXT NOT NULL,
    "store_id" TEXT,
    "txn_id" TEXT,
    "montant" DECIMAL NOT NULL,
    "payment_method" TEXT NOT NULL,
    "payment_ref" TEXT,
    "notes" TEXT,
    "collected_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "credit_payments_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "delivery_id" TEXT NOT NULL DEFAULT ('DEL-'::text || lpad((nextval('deliveries_seq'::regclass))::text, 4, '0'::text)),
    "store_id" TEXT,
    "client_id" TEXT,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "client_address" TEXT NOT NULL,
    "payment_scenario" TEXT NOT NULL,
    "montant_total" DECIMAL NOT NULL,
    "montant_avance" DECIMAL DEFAULT 0,
    "montant_restant" DECIMAL GENERATED ALWAYS AS ((montant_total - montant_avance)) STORED,
    "payment_method" TEXT,
    "payment_ref" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'confirmation_encours',
    "notes" TEXT,
    "caisse_entry_created" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "is_deleted" BOOLEAN DEFAULT false,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateTable
CREATE TABLE "delivery_items" (
    "item_id" TEXT NOT NULL DEFAULT ('DELI-'::text || lpad((nextval('delivery_items_seq'::regclass))::text, 4, '0'::text)),
    "delivery_id" TEXT,
    "device_type" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "txn_id" TEXT,
    "label_printed" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_items_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "exp_id" TEXT NOT NULL DEFAULT ('EXP-'::text || lpad((nextval('expenses_seq'::regclass))::text, 4, '0'::text)),
    "categorie" TEXT NOT NULL,
    "montant" DECIMAL(10,2) NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "fournisseur_id" TEXT,
    "facture_ref" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "store_id" TEXT,
    "receipt_photo_url" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("exp_id")
);

-- CreateTable
CREATE TABLE "ez_documents" (
    "doc_id" TEXT NOT NULL DEFAULT ('DOC-'::text || lpad((nextval('ez_doc_id_seq'::regclass))::text, 6, '0'::text)),
    "store_id" TEXT NOT NULL DEFAULT 'EZ-001',
    "doc_type" TEXT NOT NULL,
    "doc_ref" TEXT NOT NULL,
    "doc_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "phone_id" TEXT,
    "txn_id" TEXT,
    "linked_doc_ref" TEXT,
    "client_id" TEXT,
    "client_name" TEXT,
    "client_tel" TEXT,
    "client_cin" TEXT,
    "device_label" TEXT,
    "imei" TEXT,
    "montant" DECIMAL(10,2),
    "warranty_months" DECIMAL(5,2),
    "warranty_start" DATE,
    "warranty_end" DATE,
    "doc_data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "printed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ez_documents_pkey" PRIMARY KEY ("doc_id")
);

-- CreateTable
CREATE TABLE "inventory_session_items" (
    "item_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "phone_id" TEXT,
    "imei" TEXT NOT NULL,
    "phone_label" TEXT,
    "phone_status" TEXT,
    "resultat" TEXT NOT NULL DEFAULT 'en_attente',
    "scanned_at" TIMESTAMPTZ(6),

    CONSTRAINT "inventory_session_items_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "inventory_sessions" (
    "session_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" TEXT NOT NULL,
    "created_by" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "statut" TEXT NOT NULL DEFAULT 'en_cours',
    "snapshot_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "inventory_sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "laptops" (
    "laptop_id" TEXT NOT NULL DEFAULT ('LAP-'::text || lpad((nextval('laptops_seq'::regclass))::text, 4, '0'::text)),
    "serial" TEXT,
    "source" TEXT NOT NULL,
    "fournisseur_id" TEXT,
    "txn_ref_id" TEXT,
    "condition" TEXT NOT NULL,
    "marque" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "processeur" TEXT,
    "carte_graphique" TEXT,
    "stockage" TEXT,
    "ram" TEXT,
    "ecran" TEXT,
    "battery_level" INTEGER,
    "couleur" TEXT,
    "description" TEXT,
    "prix_achat" DECIMAL(10,2),
    "prix_vente_recommande" DECIMAL(10,2),
    "prix_vente_minimum" DECIMAL(10,2),
    "warranty_months" INTEGER DEFAULT 6,
    "status" TEXT NOT NULL DEFAULT 'متوفر',
    "location" TEXT NOT NULL DEFAULT 'Magasin Principal',
    "date_entree" DATE DEFAULT CURRENT_DATE,
    "notes" TEXT,
    "image_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "store_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "laptops_pkey" PRIMARY KEY ("laptop_id")
);

-- CreateTable
CREATE TABLE "phone_catalog" (
    "catalog_id" TEXT NOT NULL DEFAULT ('CAT-'::text || lpad((nextval('phone_catalog_seq'::regclass))::text, 5, '0'::text)),
    "marque" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Normal',
    "model" TEXT NOT NULL,
    "couleur" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_catalog_pkey" PRIMARY KEY ("catalog_id")
);

-- CreateTable
CREATE TABLE "phone_credit_payments" (
    "payment_id" TEXT NOT NULL DEFAULT next_credit_payment_id(),
    "credit_id" TEXT NOT NULL,
    "montant" DECIMAL(10,2) NOT NULL,
    "payment_method" TEXT NOT NULL,
    "date_paiement" DATE NOT NULL DEFAULT CURRENT_DATE,
    "notes" TEXT,
    "store_id" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_credit_payments_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "phone_credit_sales" (
    "credit_id" TEXT NOT NULL DEFAULT next_credit_id(),
    "phone_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "client_tel" TEXT,
    "client_cin" TEXT,
    "montant_total" DECIMAL(10,2) NOT NULL,
    "montant_paye" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "statut" TEXT NOT NULL DEFAULT 'en_cours',
    "phone_remis" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "store_id" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discharged_at" TIMESTAMPTZ(6),
    "discharged_by" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "has_reprise" BOOLEAN NOT NULL DEFAULT false,
    "reprise_marque" TEXT,
    "reprise_serie" TEXT,
    "reprise_model" TEXT,
    "reprise_valeur" DECIMAL(10,2),
    "reprise_imei" TEXT,
    "reprise_etat" TEXT NOT NULL DEFAULT 'bon',
    "reprise_remise" BOOLEAN NOT NULL DEFAULT false,
    "reprise_remise_at" TIMESTAMPTZ(6),
    "reprise_phone_id" TEXT,

    CONSTRAINT "phone_credit_sales_pkey" PRIMARY KEY ("credit_id")
);

-- CreateTable
CREATE TABLE "phones" (
    "phone_id" TEXT NOT NULL DEFAULT ('PHO-'::text || lpad((nextval('phones_seq'::regclass))::text, 4, '0'::text)),
    "imei" TEXT,
    "source" TEXT NOT NULL,
    "fournisseur_id" TEXT,
    "txn_ref_id" TEXT,
    "condition" TEXT NOT NULL,
    "marque" TEXT NOT NULL,
    "serie" TEXT,
    "type" TEXT,
    "couleur" TEXT,
    "model" TEXT NOT NULL,
    "stockage" TEXT,
    "battery_level" INTEGER,
    "ram" TEXT,
    "description" TEXT,
    "icloud_compte" TEXT,
    "icloud_mdp" TEXT,
    "prix_achat" DECIMAL(10,2),
    "prix_vente_recommande" DECIMAL(10,2),
    "prix_vente_minimum" DECIMAL(10,2),
    "warranty_months" INTEGER DEFAULT 6,
    "status" TEXT NOT NULL DEFAULT 'متوفر',
    "location" TEXT NOT NULL DEFAULT 'Magasin Principal',
    "date_entree" DATE DEFAULT CURRENT_DATE,
    "image_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "store_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "is_damaged" BOOLEAN DEFAULT false,
    "damage_notes" TEXT,
    "replaced_components" JSONB DEFAULT '[]',
    "promo_type" TEXT,
    "promo_montant" DECIMAL,
    "settled_at" TIMESTAMPTZ(6),
    "settled_by" UUID,

    CONSTRAINT "phones_pkey" PRIMARY KEY ("phone_id")
);

-- CreateTable
CREATE TABLE "platform_changelog" (
    "change_id" TEXT NOT NULL DEFAULT ('CHG-'::text || lpad((nextval('changelog_seq'::regclass))::text, 4, '0'::text)),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "affected_module" TEXT,
    "version_tag" TEXT,
    "author" TEXT NOT NULL,
    "changed_at" DATE NOT NULL DEFAULT CURRENT_DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "platform_changelog_pkey" PRIMARY KEY ("change_id")
);

-- CreateTable
CREATE TABLE "prospects" (
    "prospect_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'En magasin',
    "demand_type" TEXT NOT NULL DEFAULT 'modele',
    "marque" TEXT,
    "model" TEXT,
    "stockage" TEXT,
    "budget_max" DECIMAL,
    "notes" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'Nouveau',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "is_deleted" BOOLEAN DEFAULT false,

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("prospect_id")
);

-- CreateTable
CREATE TABLE "reparations" (
    "rep_id" TEXT NOT NULL DEFAULT ('REP-'::text || lpad((nextval('repairs_seq'::regclass))::text, 4, '0'::text)),
    "client_id" TEXT,
    "device_type_libre" TEXT,
    "device_serial" TEXT,
    "marque" TEXT,
    "model" TEXT NOT NULL,
    "probleme" TEXT NOT NULL,
    "diagnostic" TEXT,
    "cout_reparation" DECIMAL(10,2) DEFAULT 0,
    "avance_rep" DECIMAL(10,2) DEFAULT 0,
    "date_avance_rep" DATE,
    "statut" TEXT NOT NULL DEFAULT 'معلق',
    "date_depot" DATE NOT NULL DEFAULT CURRENT_DATE,
    "date_prevue" DATE,
    "date_livraison" DATE,
    "technicien" TEXT,
    "whatsapp_notified" BOOLEAN DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "store_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "technicien_id" UUID,

    CONSTRAINT "reparations_pkey" PRIMARY KEY ("rep_id")
);

-- CreateTable
CREATE TABLE "reparations_parts" (
    "part_id" TEXT NOT NULL DEFAULT ('PRT-'::text || lpad((nextval('parts_seq'::regclass))::text, 4, '0'::text)),
    "rep_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cout" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fournisseur" TEXT,
    "date_achat" DATE DEFAULT CURRENT_DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "reparations_parts_pkey" PRIMARY KEY ("part_id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "store_id" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_attendance" (
    "attendance_id" TEXT NOT NULL DEFAULT ('ATT-'::text || lpad((nextval('attendance_seq'::regclass))::text, 6, '0'::text)),
    "store_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "user_name" TEXT NOT NULL,
    "punch_type" TEXT NOT NULL,
    "punched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("attendance_id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "movement_id" TEXT NOT NULL DEFAULT ('MOV-'::text || lpad((nextval('movements_seq'::regclass))::text, 4, '0'::text)),
    "device_type" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "from_location" TEXT NOT NULL,
    "to_location" TEXT NOT NULL,
    "external_name" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'Transfert',
    "notes" TEXT,
    "moved_by" UUID,
    "moved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "store_id" TEXT,
    "from_store_id" TEXT,
    "to_store_id" TEXT,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("movement_id")
);

-- CreateTable
CREATE TABLE "stores" (
    "store_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme_color" TEXT NOT NULL DEFAULT '#C9A440',
    "logo_url" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("store_id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "payment_id" TEXT NOT NULL DEFAULT ('PMT-'::text || lpad((nextval('payments_seq'::regclass))::text, 4, '0'::text)),
    "supplier_id" TEXT NOT NULL,
    "montant" DECIMAL(10,2) NOT NULL,
    "payment_method" TEXT NOT NULL DEFAULT 'نقد',
    "payment_ref" TEXT,
    "facture_ref" TEXT,
    "date_paiement" DATE NOT NULL DEFAULT CURRENT_DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "store_id" TEXT,
    "payment_type" TEXT NOT NULL DEFAULT 'PAIEMENT_B',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "phone_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "supplier_id" TEXT NOT NULL DEFAULT ('SUP-'::text || lpad((nextval('suppliers_seq'::regclass))::text, 4, '0'::text)),
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "email" TEXT,
    "adresse" TEXT,
    "ville" TEXT,
    "categorie" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "store_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "type_fournisseur" TEXT DEFAULT 'B',

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("supplier_id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "txn_id" TEXT NOT NULL DEFAULT ('TXN-'::text || lpad((nextval('transactions_seq'::regclass))::text, 4, '0'::text)),
    "device_type" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "client_id" TEXT,
    "type_operation" TEXT NOT NULL,
    "txn_original_id" TEXT,
    "prix_vente" DECIMAL(10,2) NOT NULL,
    "date_vente" DATE NOT NULL DEFAULT CURRENT_DATE,
    "avance" DECIMAL(10,2) DEFAULT 0,
    "date_avance" DATE,
    "payment_method" TEXT NOT NULL,
    "montant_especes" DECIMAL(10,2) DEFAULT 0,
    "montant_carte" DECIMAL(10,2) DEFAULT 0,
    "montant_rendu" DECIMAL(10,2) DEFAULT 0,
    "payment_ref" TEXT,
    "valeur_echange" DECIMAL(10,2) DEFAULT 0,
    "marque_echange" TEXT,
    "model_echange" TEXT,
    "stockage_echange" TEXT,
    "ram_echange" TEXT,
    "etat_batterie_echange" INTEGER,
    "imei_echange" TEXT,
    "description_echange" TEXT,
    "warranty_start" DATE,
    "warranty_expiry" DATE,
    "override_required" BOOLEAN DEFAULT false,
    "override_by" UUID,
    "override_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "store_id" TEXT,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "voided_by" UUID,
    "voided_at" TIMESTAMPTZ(6),
    "voided_reason" TEXT,
    "facture_ref" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("txn_id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "display_name" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'staff',
    "override_pin" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "store_id" TEXT,
    "avatar_url" TEXT,
    "store_locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_events" (
    "event_id" TEXT NOT NULL DEFAULT ('WEV-'::text || lpad((nextval('warranty_events_seq'::regclass))::text, 4, '0'::text)),
    "store_id" TEXT NOT NULL DEFAULT 'EZ-001',
    "txn_id" TEXT NOT NULL,
    "facture_ref" TEXT NOT NULL,
    "sav_doc_id" TEXT,
    "sav_ref" TEXT,
    "event_type" TEXT NOT NULL,
    "event_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "warranty_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accessories_barcode_key" ON "accessories"("barcode");

-- CreateIndex
CREATE INDEX "idx_accessories_low_stock" ON "accessories"("quantite", "seuil_alerte");

-- CreateIndex
CREATE INDEX "idx_accessories_store" ON "accessories"("store_id");

-- CreateIndex
CREATE INDEX "idx_activity_log_created" ON "activity_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_activity_log_module" ON "activity_log"("module");

-- CreateIndex
CREATE INDEX "idx_activity_log_store" ON "activity_log"("store_id");

-- CreateIndex
CREATE INDEX "idx_activity_log_user" ON "activity_log"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "caisse_date_key" ON "caisse"("date");

-- CreateIndex
CREATE INDEX "idx_caisse_store" ON "caisse"("store_id");

-- CreateIndex
CREATE INDEX "idx_clients_store" ON "clients"("store_id");

-- CreateIndex
CREATE INDEX "idx_expenses_store" ON "expenses"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "ez_documents_doc_ref_key" ON "ez_documents"("doc_ref");

-- CreateIndex
CREATE INDEX "idx_ez_documents_client_name" ON "ez_documents"("client_name");

-- CreateIndex
CREATE INDEX "idx_ez_documents_doc_date" ON "ez_documents"("doc_date" DESC);

-- CreateIndex
CREATE INDEX "idx_ez_documents_doc_type" ON "ez_documents"("doc_type");

-- CreateIndex
CREATE INDEX "idx_ez_documents_imei" ON "ez_documents"("imei");

-- CreateIndex
CREATE INDEX "idx_ez_documents_phone_id" ON "ez_documents"("phone_id");

-- CreateIndex
CREATE INDEX "idx_ez_documents_store_id" ON "ez_documents"("store_id");

-- CreateIndex
CREATE INDEX "idx_ez_documents_txn_id" ON "ez_documents"("txn_id");

-- CreateIndex
CREATE INDEX "idx_inv_items_imei" ON "inventory_session_items"("imei");

-- CreateIndex
CREATE INDEX "idx_inv_items_resultat" ON "inventory_session_items"("resultat");

-- CreateIndex
CREATE INDEX "idx_inv_items_session" ON "inventory_session_items"("session_id");

-- CreateIndex
CREATE INDEX "idx_inv_sessions_statut" ON "inventory_sessions"("statut");

-- CreateIndex
CREATE INDEX "idx_inv_sessions_store" ON "inventory_sessions"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "laptops_serial_key" ON "laptops"("serial");

-- CreateIndex
CREATE INDEX "idx_laptops_location" ON "laptops"("location");

-- CreateIndex
CREATE INDEX "idx_laptops_status" ON "laptops"("status");

-- CreateIndex
CREATE INDEX "idx_laptops_store" ON "laptops"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_catalog_model_couleur_key" ON "phone_catalog"("model", "couleur");

-- CreateIndex
CREATE INDEX "idx_pcp_credit_id" ON "phone_credit_payments"("credit_id");

-- CreateIndex
CREATE INDEX "idx_pcp_date" ON "phone_credit_payments"("date_paiement");

-- CreateIndex
CREATE INDEX "idx_pcp_store_date" ON "phone_credit_payments"("store_id", "date_paiement");

-- CreateIndex
CREATE INDEX "idx_pcs_phone_id" ON "phone_credit_sales"("phone_id");

-- CreateIndex
CREATE INDEX "idx_pcs_statut" ON "phone_credit_sales"("statut") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "idx_pcs_store" ON "phone_credit_sales"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "phones_imei_key" ON "phones"("imei");

-- CreateIndex
CREATE INDEX "idx_phones_location" ON "phones"("location");

-- CreateIndex
CREATE INDEX "idx_phones_marque" ON "phones"("marque");

-- CreateIndex
CREATE INDEX "idx_phones_status" ON "phones"("status");

-- CreateIndex
CREATE INDEX "idx_phones_store" ON "phones"("store_id");

-- CreateIndex
CREATE INDEX "idx_prospects_statut" ON "prospects"("statut");

-- CreateIndex
CREATE INDEX "idx_prospects_store_id" ON "prospects"("store_id");

-- CreateIndex
CREATE INDEX "idx_reparations_client_id" ON "reparations"("client_id");

-- CreateIndex
CREATE INDEX "idx_reparations_statut" ON "reparations"("statut");

-- CreateIndex
CREATE INDEX "idx_reparations_store" ON "reparations"("store_id");

-- CreateIndex
CREATE INDEX "idx_parts_rep_id" ON "reparations_parts"("rep_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_store_id_unique" ON "settings"("key", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_per_store_unique" ON "settings"("key", "store_id") WHERE (store_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_attendance_date" ON "staff_attendance"("date");

-- CreateIndex
CREATE INDEX "idx_attendance_store" ON "staff_attendance"("store_id");

-- CreateIndex
CREATE INDEX "idx_attendance_user" ON "staff_attendance"("user_id");

-- CreateIndex
CREATE INDEX "idx_movements_device_id" ON "stock_movements"("device_id");

-- CreateIndex
CREATE INDEX "idx_transactions_client_id" ON "transactions"("client_id");

-- CreateIndex
CREATE INDEX "idx_transactions_date_vente" ON "transactions"("date_vente" DESC);

-- CreateIndex
CREATE INDEX "idx_transactions_device_id" ON "transactions"("device_id");

-- CreateIndex
CREATE INDEX "idx_transactions_facture_ref" ON "transactions"("facture_ref");

-- CreateIndex
CREATE INDEX "idx_transactions_store" ON "transactions"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_email_key" ON "user_profiles"("email");

-- CreateIndex
CREATE INDEX "idx_warranty_events_facture_ref" ON "warranty_events"("facture_ref");

-- CreateIndex
CREATE INDEX "idx_warranty_events_txn_id" ON "warranty_events"("txn_id");

-- AddForeignKey
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_fournisseur_id_fkey" FOREIGN KEY ("fournisseur_id") REFERENCES "suppliers"("supplier_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "caisse" ADD CONSTRAINT "caisse_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "caisse" ADD CONSTRAINT "caisse_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "caisse" ADD CONSTRAINT "caisse_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "caisse" ADD CONSTRAINT "caisse_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cash_drops" ADD CONSTRAINT "cash_drops_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cash_drops" ADD CONSTRAINT "cash_drops_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_import_payments" ADD CONSTRAINT "credit_import_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_import_payments" ADD CONSTRAINT "credit_import_payments_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "credit_imports"("import_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_import_payments" ADD CONSTRAINT "credit_import_payments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_imports" ADD CONSTRAINT "credit_imports_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_imports" ADD CONSTRAINT "credit_imports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_imports" ADD CONSTRAINT "credit_imports_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_collected_by_fkey" FOREIGN KEY ("collected_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "transactions"("txn_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("delivery_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "transactions"("txn_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_fournisseur_id_fkey" FOREIGN KEY ("fournisseur_id") REFERENCES "suppliers"("supplier_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ez_documents" ADD CONSTRAINT "ez_documents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ez_documents" ADD CONSTRAINT "ez_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ez_documents" ADD CONSTRAINT "ez_documents_phone_id_fkey" FOREIGN KEY ("phone_id") REFERENCES "phones"("phone_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ez_documents" ADD CONSTRAINT "ez_documents_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "transactions"("txn_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_session_items" ADD CONSTRAINT "inventory_session_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_sessions"("session_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "inventory_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "laptops" ADD CONSTRAINT "fk_laptops_txn_ref" FOREIGN KEY ("txn_ref_id") REFERENCES "transactions"("txn_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "laptops" ADD CONSTRAINT "laptops_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "laptops" ADD CONSTRAINT "laptops_fournisseur_id_fkey" FOREIGN KEY ("fournisseur_id") REFERENCES "suppliers"("supplier_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "laptops" ADD CONSTRAINT "laptops_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "laptops" ADD CONSTRAINT "laptops_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_credit_payments" ADD CONSTRAINT "phone_credit_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_credit_payments" ADD CONSTRAINT "phone_credit_payments_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "phone_credit_sales"("credit_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_credit_sales" ADD CONSTRAINT "phone_credit_sales_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_credit_sales" ADD CONSTRAINT "phone_credit_sales_discharged_by_fkey" FOREIGN KEY ("discharged_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_credit_sales" ADD CONSTRAINT "phone_credit_sales_phone_id_fkey" FOREIGN KEY ("phone_id") REFERENCES "phones"("phone_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phones" ADD CONSTRAINT "fk_phones_supplier" FOREIGN KEY ("fournisseur_id") REFERENCES "suppliers"("supplier_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phones" ADD CONSTRAINT "fk_phones_txn_ref" FOREIGN KEY ("txn_ref_id") REFERENCES "transactions"("txn_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phones" ADD CONSTRAINT "phones_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phones" ADD CONSTRAINT "phones_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phones" ADD CONSTRAINT "phones_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "platform_changelog" ADD CONSTRAINT "platform_changelog_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reparations" ADD CONSTRAINT "reparations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reparations" ADD CONSTRAINT "reparations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reparations" ADD CONSTRAINT "reparations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reparations" ADD CONSTRAINT "reparations_technicien_id_fkey" FOREIGN KEY ("technicien_id") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reparations" ADD CONSTRAINT "reparations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reparations_parts" ADD CONSTRAINT "reparations_parts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reparations_parts" ADD CONSTRAINT "reparations_parts_rep_id_fkey" FOREIGN KEY ("rep_id") REFERENCES "reparations"("rep_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_store_id_fkey" FOREIGN KEY ("from_store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_moved_by_fkey" FOREIGN KEY ("moved_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_store_id_fkey" FOREIGN KEY ("to_store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("supplier_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_override_by_fkey" FOREIGN KEY ("override_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_txn_original_id_fkey" FOREIGN KEY ("txn_original_id") REFERENCES "transactions"("txn_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "warranty_events" ADD CONSTRAINT "warranty_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "warranty_events" ADD CONSTRAINT "warranty_events_sav_doc_id_fkey" FOREIGN KEY ("sav_doc_id") REFERENCES "ez_documents"("doc_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "warranty_events" ADD CONSTRAINT "warranty_events_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "transactions"("txn_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Allowed values of former Postgres enums (columns are now TEXT)
ALTER TABLE "public"."accessories" ADD CONSTRAINT "accessories_location_allowed" CHECK ("location" IN ('Magasin Principal', 'Magasin Secondaire', 'Externe'));
ALTER TABLE "public"."deliveries" ADD CONSTRAINT "deliveries_payment_method_allowed" CHECK ("payment_method" IN ('نقد', 'تحويل', 'تسبيق', 'إستبدال', 'مختلط', 'آجل'));
ALTER TABLE "public"."delivery_items" ADD CONSTRAINT "delivery_items_device_type_allowed" CHECK ("device_type" IN ('هاتف', 'لابتوب', 'إكسسوار'));
ALTER TABLE "public"."laptops" ADD CONSTRAINT "laptops_source_allowed" CHECK ("source" IN ('Fournisseur', 'Reprise', 'Échange'));
ALTER TABLE "public"."laptops" ADD CONSTRAINT "laptops_condition_allowed" CHECK ("condition" IN ('جديد', 'مستعمل', 'معطوب'));
ALTER TABLE "public"."laptops" ADD CONSTRAINT "laptops_status_allowed" CHECK ("status" IN ('متوفر', 'مباع', 'إستبدال', 'إصلاح', 'en_livraison', 'en_transfert', 'حجز'));
ALTER TABLE "public"."laptops" ADD CONSTRAINT "laptops_location_allowed" CHECK ("location" IN ('Magasin Principal', 'Magasin Secondaire', 'Externe'));
ALTER TABLE "public"."phones" ADD CONSTRAINT "phones_source_allowed" CHECK ("source" IN ('Fournisseur', 'Reprise', 'Échange'));
ALTER TABLE "public"."phones" ADD CONSTRAINT "phones_condition_allowed" CHECK ("condition" IN ('جديد', 'مستعمل', 'معطوب'));
ALTER TABLE "public"."phones" ADD CONSTRAINT "phones_status_allowed" CHECK ("status" IN ('متوفر', 'مباع', 'إستبدال', 'إصلاح', 'en_livraison', 'en_transfert', 'حجز'));
ALTER TABLE "public"."phones" ADD CONSTRAINT "phones_location_allowed" CHECK ("location" IN ('Magasin Principal', 'Magasin Secondaire', 'Externe'));
ALTER TABLE "public"."reparations" ADD CONSTRAINT "reparations_statut_allowed" CHECK ("statut" IN ('معلق', 'جاهز'));
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_device_type_allowed" CHECK ("device_type" IN ('هاتف', 'لابتوب', 'إكسسوار'));
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_from_location_allowed" CHECK ("from_location" IN ('Magasin Principal', 'Magasin Secondaire', 'Externe'));
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_to_location_allowed" CHECK ("to_location" IN ('Magasin Principal', 'Magasin Secondaire', 'Externe'));
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_reason_allowed" CHECK ("reason" IN ('Transfert', 'Réparation Externe', 'Retour', 'Prêt'));
ALTER TABLE "public"."supplier_payments" ADD CONSTRAINT "supplier_payments_payment_method_allowed" CHECK ("payment_method" IN ('نقد', 'تحويل', 'تسبيق', 'إستبدال', 'مختلط', 'آجل'));
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transactions_device_type_allowed" CHECK ("device_type" IN ('هاتف', 'لابتوب', 'إكسسوار'));
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transactions_type_operation_allowed" CHECK ("type_operation" IN ('بيع', 'إستبدال', 'تسبيق', 'Retour'));
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transactions_payment_method_allowed" CHECK ("payment_method" IN ('نقد', 'تحويل', 'تسبيق', 'إستبدال', 'مختلط', 'آجل'));

-- CHECK constraints
ALTER TABLE "public"."suppliers" ADD CONSTRAINT "suppliers_type_fournisseur_check" CHECK ((type_fournisseur = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])));
ALTER TABLE "public"."phones" ADD CONSTRAINT "phones_battery_level_check" CHECK (((battery_level >= 0) AND (battery_level <= 100)));
ALTER TABLE "public"."laptops" ADD CONSTRAINT "laptops_battery_level_check" CHECK (((battery_level >= 0) AND (battery_level <= 100)));
ALTER TABLE "public"."supplier_payments" ADD CONSTRAINT "supplier_payments_payment_type_check" CHECK ((payment_type = ANY (ARRAY['REGLEMENT_A'::text, 'AVANCE_A'::text, 'PAIEMENT_B'::text])));
ALTER TABLE "public"."caisse" ADD CONSTRAINT "caisse_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'pending_eod'::text, 'closed'::text])));
ALTER TABLE "public"."staff_attendance" ADD CONSTRAINT "staff_attendance_punch_type_check" CHECK ((punch_type = ANY (ARRAY['in'::text, 'out'::text])));
ALTER TABLE "public"."deliveries" ADD CONSTRAINT "deliveries_payment_scenario_check" CHECK ((payment_scenario = ANY (ARRAY['full_advance'::text, 'partial_advance'::text, 'on_delivery'::text])));
ALTER TABLE "public"."deliveries" ADD CONSTRAINT "deliveries_statut_check" CHECK ((statut = ANY (ARRAY['confirmation_encours'::text, 'attente_avance'::text, 'prepare'::text, 'en_transit'::text, 'livre'::text, 'annule'::text, 'retour'::text])));
ALTER TABLE "public"."cash_drops" ADD CONSTRAINT "cash_drops_amount_check" CHECK ((amount > (0)::numeric));
ALTER TABLE "public"."credit_payments" ADD CONSTRAINT "credit_payments_montant_check" CHECK ((montant > (0)::numeric));
ALTER TABLE "public"."credit_imports" ADD CONSTRAINT "credit_imports_montant_du_check" CHECK ((montant_du > (0)::numeric));
ALTER TABLE "public"."credit_imports" ADD CONSTRAINT "credit_imports_statut_check" CHECK ((statut = ANY (ARRAY['en_cours'::text, 'soldé'::text])));
ALTER TABLE "public"."ez_documents" ADD CONSTRAINT "ez_documents_doc_type_check" CHECK ((doc_type = ANY (ARRAY['FAC'::text, 'RCH'::text, 'ECH'::text, 'PEC'::text, 'RST'::text])));
ALTER TABLE "public"."warranty_events" ADD CONSTRAINT "warranty_events_event_type_check" CHECK ((event_type = ANY (ARRAY['SAV_OPEN'::text, 'SAV_CLOSE'::text])));
ALTER TABLE "public"."phone_credit_sales" ADD CONSTRAINT "phone_credit_sales_montant_paye_check" CHECK ((montant_paye >= (0)::numeric));
ALTER TABLE "public"."phone_credit_sales" ADD CONSTRAINT "phone_credit_sales_montant_total_check" CHECK ((montant_total > (0)::numeric));
ALTER TABLE "public"."phone_credit_sales" ADD CONSTRAINT "phone_credit_sales_statut_check" CHECK ((statut = ANY (ARRAY['en_cours'::text, 'solde'::text, 'annule'::text])));
ALTER TABLE "public"."phone_credit_payments" ADD CONSTRAINT "phone_credit_payments_montant_check" CHECK ((montant > (0)::numeric));
ALTER TABLE "public"."phone_credit_payments" ADD CONSTRAINT "phone_credit_payments_payment_method_check" CHECK ((payment_method = ANY (ARRAY['نقد'::text, 'تحويل'::text])));
ALTER TABLE "public"."credit_import_payments" ADD CONSTRAINT "credit_import_payments_montant_check" CHECK ((montant > (0)::numeric));

-- Triggers
CREATE TRIGGER deliveries_updated_at BEFORE UPDATE ON public.deliveries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER stores_updated_at BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_accessories_barcode BEFORE INSERT ON public.accessories FOR EACH ROW EXECUTE FUNCTION set_accessory_barcode();
CREATE TRIGGER trg_accessories_updated_at BEFORE UPDATE ON public.accessories FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_laptops_updated_at BEFORE UPDATE ON public.laptops FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_phones_updated_at BEFORE UPDATE ON public.phones FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_reparations_updated_at BEFORE UPDATE ON public.reparations FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_supplier_payments_updated_at BEFORE UPDATE ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_sync_import_balance AFTER INSERT ON public.credit_import_payments FOR EACH ROW EXECUTE FUNCTION sync_credit_import_balance();
CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Views
CREATE VIEW "public"."accessories_with_status" AS
SELECT acc_id,
    barcode,
    nom,
    categorie,
    marque,
    compatible_with,
    prix_achat,
    prix_vente_recommande,
    prix_vente_minimum,
    quantite,
    seuil_alerte,
    fournisseur_id,
    location,
    image_url,
    store_id,
    is_deleted,
    created_at,
    created_by,
    updated_at,
    updated_by,
        CASE
            WHEN quantite <= 0 THEN 'نفذ'::text
            WHEN quantite <= seuil_alerte THEN 'تحذير'::text
            ELSE 'متوفر'::text
        END AS status_computed,
    quantite <= seuil_alerte AS is_low_stock
   FROM accessories
  WHERE is_deleted = false;

CREATE VIEW "public"."client_summary" AS
SELECT c.client_id,
    c.nom,
    c.telephone,
    c.telephone_2,
    c.email,
    c.adresse,
    c.date_premier_achat,
    c.notes,
    c.created_at,
    c.created_by,
    c.updated_at,
    c.updated_by,
    c.store_id,
    c.is_deleted,
    COALESCE(t.total_ca, 0::numeric) AS total_ca,
    GREATEST(COALESCE(t.total_impaye, 0::numeric) + COALESCE(ci.total_imports, 0::numeric) - COALESCE(cp.total_paid, 0::numeric), 0::numeric) AS solde_impaye,
    COALESCE(r.nb_reparations, 0::bigint) AS total_reparations
   FROM clients c
     LEFT JOIN ( SELECT transactions.client_id,
            sum(transactions.prix_vente) AS total_ca,
            sum(
                CASE
                    WHEN transactions.payment_method = 'إستبدال'::text THEN 0::numeric
                    WHEN transactions.payment_method = 'آجل'::text THEN GREATEST(transactions.prix_vente - COALESCE(transactions.valeur_echange, 0::numeric), 0::numeric)
                    WHEN transactions.avance > 0::numeric THEN GREATEST(transactions.prix_vente - transactions.avance - COALESCE(transactions.valeur_echange, 0::numeric), 0::numeric)
                    ELSE 0::numeric
                END) AS total_impaye
           FROM transactions
          WHERE transactions.voided = false
          GROUP BY transactions.client_id) t ON t.client_id = c.client_id
     LEFT JOIN ( SELECT credit_imports.client_id,
            sum(credit_imports.montant_du) AS total_imports
           FROM credit_imports
          WHERE credit_imports.client_id IS NOT NULL
          GROUP BY credit_imports.client_id) ci ON ci.client_id = c.client_id
     LEFT JOIN ( SELECT credit_payments.client_id,
            sum(credit_payments.montant) AS total_paid
           FROM credit_payments
          GROUP BY credit_payments.client_id) cp ON cp.client_id = c.client_id
     LEFT JOIN ( SELECT reparations.client_id,
            count(*) AS nb_reparations
           FROM reparations
          WHERE reparations.is_deleted = false
          GROUP BY reparations.client_id) r ON r.client_id = c.client_id;

CREATE VIEW "public"."suppliers_summary" AS
SELECT supplier_id,
    nom,
    telephone,
    email,
    adresse,
    ville,
    categorie,
    type_fournisseur,
    notes,
    created_at,
    created_by,
    updated_at,
    updated_by,
    store_id,
    is_deleted,
    COALESCE(( SELECT count(*)::integer AS count
           FROM phones p
          WHERE p.fournisseur_id = s.supplier_id AND p.status = 'متوفر'::text AND p.is_deleted = false), 0) AS nb_en_stock,
    COALESCE(( SELECT count(*)::integer AS count
           FROM phones p
          WHERE p.fournisseur_id = s.supplier_id AND p.status = 'مباع'::text AND p.is_deleted = false), 0) AS nb_vendus,
    COALESCE(( SELECT sum(p.prix_achat) AS sum
           FROM phones p
          WHERE p.fournisseur_id = s.supplier_id AND p.is_deleted = false), 0::numeric) AS total_achats,
        CASE
            WHEN type_fournisseur = 'A'::text THEN COALESCE(( SELECT sum(
                    CASE
                        WHEN fac.doc_id IS NOT NULL THEN GREATEST(fac.montant - COALESCE(ech.montant, 0::numeric), 0::numeric)
                        ELSE COALESCE(p.prix_achat, 0::numeric)
                    END) AS sum
               FROM phones p
                 LEFT JOIN LATERAL ( SELECT ez_documents.doc_id,
                        ez_documents.montant,
                        ez_documents.doc_ref
                       FROM ez_documents
                      WHERE ez_documents.phone_id = p.phone_id AND ez_documents.doc_type = 'FAC'::text
                      ORDER BY ez_documents.created_at DESC
                     LIMIT 1) fac ON true
                 LEFT JOIN LATERAL ( SELECT COALESCE(sum(ez_documents.montant), 0::numeric) AS montant
                       FROM ez_documents
                      WHERE ez_documents.doc_type = 'ECH'::text AND ez_documents.linked_doc_ref = fac.doc_ref) ech ON fac.doc_id IS NOT NULL
              WHERE p.fournisseur_id = s.supplier_id AND p.status = 'مباع'::text AND p.settled_at IS NOT NULL AND p.is_deleted = false), 0::numeric) + COALESCE(( SELECT sum(sp.montant) AS sum
               FROM supplier_payments sp
              WHERE sp.supplier_id = s.supplier_id AND sp.payment_type = 'AVANCE_A'::text AND sp.is_deleted = false), 0::numeric)
            ELSE COALESCE(( SELECT sum(sp.montant) AS sum
               FROM supplier_payments sp
              WHERE sp.supplier_id = s.supplier_id AND sp.is_deleted = false), 0::numeric)
        END AS total_paye,
        CASE
            WHEN type_fournisseur = 'A'::text THEN COALESCE(( SELECT sum(
                    CASE
                        WHEN fac.doc_id IS NOT NULL THEN GREATEST(fac.montant - COALESCE(ech.montant, 0::numeric), 0::numeric)
                        ELSE COALESCE(p.prix_achat, 0::numeric)
                    END) AS sum
               FROM phones p
                 LEFT JOIN LATERAL ( SELECT ez_documents.doc_id,
                        ez_documents.montant,
                        ez_documents.doc_ref
                       FROM ez_documents
                      WHERE ez_documents.phone_id = p.phone_id AND ez_documents.doc_type = 'FAC'::text
                      ORDER BY ez_documents.created_at DESC
                     LIMIT 1) fac ON true
                 LEFT JOIN LATERAL ( SELECT COALESCE(sum(ez_documents.montant), 0::numeric) AS montant
                       FROM ez_documents
                      WHERE ez_documents.doc_type = 'ECH'::text AND ez_documents.linked_doc_ref = fac.doc_ref) ech ON fac.doc_id IS NOT NULL
              WHERE p.fournisseur_id = s.supplier_id AND p.status = 'مباع'::text AND p.settled_at IS NULL AND p.is_deleted = false), 0::numeric)
            ELSE COALESCE(( SELECT sum(p.prix_achat) AS sum
               FROM phones p
              WHERE p.fournisseur_id = s.supplier_id AND p.is_deleted = false), 0::numeric) - COALESCE(( SELECT sum(sp.montant) AS sum
               FROM supplier_payments sp
              WHERE sp.supplier_id = s.supplier_id AND sp.is_deleted = false), 0::numeric)
        END AS solde_du,
        CASE
            WHEN type_fournisseur = 'A'::text THEN COALESCE(( SELECT sum(
                    CASE
                        WHEN fac.doc_id IS NOT NULL THEN GREATEST(fac.montant - COALESCE(ech.montant, 0::numeric), 0::numeric)
                        ELSE COALESCE(p.prix_achat, 0::numeric)
                    END) AS sum
               FROM phones p
                 LEFT JOIN LATERAL ( SELECT ez_documents.doc_id,
                        ez_documents.montant,
                        ez_documents.doc_ref
                       FROM ez_documents
                      WHERE ez_documents.phone_id = p.phone_id AND ez_documents.doc_type = 'FAC'::text
                      ORDER BY ez_documents.created_at DESC
                     LIMIT 1) fac ON true
                 LEFT JOIN LATERAL ( SELECT COALESCE(sum(ez_documents.montant), 0::numeric) AS montant
                       FROM ez_documents
                      WHERE ez_documents.doc_type = 'ECH'::text AND ez_documents.linked_doc_ref = fac.doc_ref) ech ON fac.doc_id IS NOT NULL
              WHERE p.fournisseur_id = s.supplier_id AND p.status = 'مباع'::text AND p.settled_at IS NOT NULL AND p.is_deleted = false), 0::numeric)
            ELSE NULL::numeric
        END AS a_montant_vendu_regle,
        CASE
            WHEN type_fournisseur = 'A'::text THEN COALESCE(( SELECT sum(p.prix_achat) AS sum
               FROM phones p
              WHERE p.fournisseur_id = s.supplier_id AND p.status = 'متوفر'::text AND p.is_deleted = false), 0::numeric)
            ELSE NULL::numeric
        END AS a_montant_en_stock
   FROM suppliers s
  WHERE is_deleted = false;

CREATE VIEW "public"."phones_unsettled_a" AS
SELECT p.phone_id,
    p.fournisseur_id,
    p.store_id,
    p.marque,
    p.model,
    p.imei,
    p.couleur,
    p.stockage,
    p.prix_achat,
    p.updated_at AS sold_at,
        CASE
            WHEN fac.doc_id IS NOT NULL THEN GREATEST(fac.montant - COALESCE(ech.montant, 0::numeric), 0::numeric)
            ELSE COALESCE(p.prix_achat, 0::numeric)
        END AS cash_recu,
    fac.doc_ref AS fac_ref,
    fac.montant AS fac_montant,
    COALESCE(ech.montant, 0::numeric) AS ech_montant
   FROM phones p
     LEFT JOIN LATERAL ( SELECT ez_documents.doc_id,
            ez_documents.montant,
            ez_documents.doc_ref
           FROM ez_documents
          WHERE ez_documents.phone_id = p.phone_id AND ez_documents.doc_type = 'FAC'::text
          ORDER BY ez_documents.created_at DESC
         LIMIT 1) fac ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(ez_documents.montant), 0::numeric) AS montant
           FROM ez_documents
          WHERE ez_documents.doc_type = 'ECH'::text AND ez_documents.linked_doc_ref = fac.doc_ref) ech ON fac.doc_id IS NOT NULL
  WHERE p.status = 'مباع'::text AND p.settled_at IS NULL AND p.is_deleted = false;

CREATE VIEW "public"."phone_credits_summary" AS
SELECT pcs.credit_id,
    pcs.phone_id,
    pcs.client_name,
    pcs.client_tel,
    pcs.client_cin,
    pcs.montant_total,
    pcs.montant_paye,
    pcs.statut,
    pcs.phone_remis,
    pcs.notes,
    pcs.store_id,
    pcs.created_by,
    pcs.created_at,
    pcs.discharged_at,
    pcs.discharged_by,
    pcs.is_deleted,
    pcs.has_reprise,
    pcs.reprise_marque,
    pcs.reprise_serie,
    pcs.reprise_model,
    pcs.reprise_valeur,
    pcs.reprise_imei,
    pcs.reprise_etat,
    pcs.reprise_remise,
    pcs.reprise_remise_at,
    pcs.reprise_phone_id,
    p.model,
    p.serie,
    p.marque,
    p.status AS phone_status,
    p.prix_vente_recommande,
    p.prix_achat,
    p.imei,
    pcs.montant_total - COALESCE(pcs.reprise_valeur, 0::numeric) AS montant_cash_total,
    pcs.montant_total - COALESCE(pcs.reprise_valeur, 0::numeric) - pcs.montant_paye AS montant_restant,
    round(pcs.montant_paye::numeric / NULLIF(pcs.montant_total - COALESCE(pcs.reprise_valeur, 0::numeric), 0::numeric) * 100::numeric, 1) AS pct_paye
   FROM phone_credit_sales pcs
     JOIN phones p ON p.phone_id = pcs.phone_id
  WHERE pcs.is_deleted = false;
