-- Budget prospects get a floor: a 6 000 DH request no longer matches 1 000 DH
-- phones. NULL = no floor (every prospect created before this change).
ALTER TABLE "prospects" ADD COLUMN "budget_min" DECIMAL;
