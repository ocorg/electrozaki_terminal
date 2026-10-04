-- A refund paid outside the drawer (owner, 2026-10-04): the client is paid
-- back with money that is not the day's caisse (the owner's own money). The
-- return counts like any other; the drawer is not touched.
ALTER TYPE "retour_mode" ADD VALUE IF NOT EXISTS 'hors_caisse';
