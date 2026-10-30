-- Month-end close (spec 2.5, client 2026-10-28): a closed month is locked in production AND in the
-- store books (inventorydb.inventory_books_locks). Months approved under the old monthly close
-- (productiondb.monthly_material_close status APPROVED) were never locked in the store books.
--
-- Run against productiondb with `psql -At`: it prints one idempotent INSERT per closed month, which
-- release_verified.sh then runs against inventorydb (the two databases cannot see each other).
-- ON CONFLICT DO NOTHING keeps any lock row inventory already has (a later re-open stays re-opened).
-- No closed month prints nothing, and an empty script is a no-op.
SELECT format(
  'INSERT INTO inventory_books_locks (id, plant_id, month, status, locked_by, locked_at, lock_note, history, created_at, updated_at) '
  'VALUES (gen_random_uuid(), %L, %L, ''LOCKED'', %L, %L, %L, %L::json, now(), now()) ON CONFLICT (plant_id, month) DO NOTHING;',
  c.plant_id::text,
  date_trunc('month', c.month_start)::date,
  who,
  at,
  note,
  json_build_array(json_build_object('action', 'LOCKED', 'by', who, 'at', to_char(at, 'YYYY-MM-DD"T"HH24:MI:SS'), 'note', note))::text
)
FROM monthly_material_close c
CROSS JOIN LATERAL (
  SELECT
    coalesce(nullif(trim(c.approved_by), ''), 'system') AS who,
    coalesce(c.approved_at, c.locked_at, c.updated_at, now() AT TIME ZONE 'UTC') AS at,
    'Closed before the store books lock existed (release 28 Oct 2026)'::text AS note
) AS x
WHERE c.status = 'APPROVED'
ORDER BY c.plant_id, c.month_start;
