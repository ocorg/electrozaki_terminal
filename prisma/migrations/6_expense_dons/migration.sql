-- "Dons" expense category (help given to people in need). Counted as an
-- expense like the others (owner's decision, 2026-09-27). More categories can
-- be added by the owner in BZG → Paramètres.
INSERT INTO "categories" ("code", "type", "label_fr", "label_ar", "sort_order")
VALUES ('dons', 'depense', 'Dons', 'تبرعات', 9)
ON CONFLICT ("code") DO NOTHING;
