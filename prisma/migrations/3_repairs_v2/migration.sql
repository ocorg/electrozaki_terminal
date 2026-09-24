-- Repairs v2: kinds (hardware / software / online consultation), structured
-- problems, quote step, payment method, drop-off photos, cancel with reason.

CREATE TYPE "repair_kind" AS ENUM ('materiel', 'logiciel', 'consultation');

-- Quote sent to the customer, waiting for their answer (before 'en_cours').
ALTER TYPE "repair_status" ADD VALUE IF NOT EXISTS 'devis_envoye' BEFORE 'en_cours';

ALTER TABLE "reparations"
  ADD COLUMN "type_reparation"  "repair_kind" NOT NULL DEFAULT 'materiel',
  -- problem codes (src/lib/codes.ts → repair_problem); "probleme" keeps the free description
  ADD COLUMN "problemes"        TEXT[] DEFAULT ARRAY[]::TEXT[],
  -- how the repair is paid; NULL = espèces (every ticket before this change)
  ADD COLUMN "mode_paiement"    "payment_method",
  ADD COLUMN "devis_envoye_le"  TIMESTAMPTZ(6),
  ADD COLUMN "devis_accepte_le" TIMESTAMPTZ(6),
  ADD COLUMN "devis_refuse_le"  TIMESTAMPTZ(6),
  ADD COLUMN "photos_depot"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  -- cancel = hidden (is_deleted) but kept, with who / when / why
  ADD COLUMN "annule_le"        TIMESTAMPTZ(6),
  ADD COLUMN "annule_par"       UUID,
  ADD COLUMN "motif_annulation" TEXT;
