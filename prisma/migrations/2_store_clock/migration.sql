-- Morocco is on GMT+0 for good since September 2026, but Postgres' time-zone
-- data still treats 'Africa/Casablanca' as GMT+1. Document numbers take their
-- year from the store's clock (GMT+0, same as src/lib/time.ts) instead, so the
-- new year starts at midnight — not at 23:00 on 31 December.
CREATE OR REPLACE FUNCTION public.next_doc_ref(prefix text, seq_name text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  n   INTEGER;
  yr  TEXT;
BEGIN
  EXECUTE format('SELECT nextval(%L)', seq_name) INTO n;
  yr := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY');
  RETURN prefix || '-' || yr || '-' || lpad(n::text, 6, '0');
END;
$function$;
