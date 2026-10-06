-- Case-insensitive uniqueness on assets.asset_code.
--
-- `asset_code text not null unique` (20260927000100) made the code unique by
-- exact string, and a Postgres `text` comparison is case- and whitespace-sensitive.
-- So `AST-0001`, `ast-0001` and `AST-0001` with a trailing space were three
-- different rows and all three inserts succeeded. Verified on a local stack:
--
--   insert into t values ('AST-0001');  -- INSERT 0 1
--   insert into t values ('ast-0001');  -- INSERT 0 1
--   insert into t values ('  AST-0001  '); -- INSERT 0 1
--
-- The app already trims the column (`normalise()` in `assetService.ts` calls
-- `.trim()`), so the whitespace half of the gap is closed on the client. The
-- case half is not, and it is the one that matters: an asset register whose
-- whole point is a unique identifier cannot hold `AST-0001` twice in two
-- spellings.
--
-- This replaces the constraint with a unique index over the normalised
-- expression, which is what actually refuses the second insert.

-- ---------------------------------------------------------------------------
-- Guard: refuse rather than fail obscurely
-- ---------------------------------------------------------------------------
-- The index would fail on its own if two existing rows differ only by case, and
-- it would fail with `23505` on an index name that says nothing about which
-- asset_codes collided. The remote has no re-apply path, so the file states
-- which ones collide before the statement that would raise.
--
-- `btrim` rather than `trim`: the same function the app uses, and it handles
-- both spaces and tabs. Empty on both databases at the time of writing — the
-- data check is what makes this a guard rather than a hope.
do $$
declare
  collisions text;
begin
  select string_agg(normalised || ' (' || variants || ')', '; ' order by normalised)
    into collisions
    from (
      select upper(btrim(asset_code)) as normalised,
             string_agg(asset_code, ' | ' order by asset_code) as variants
        from public.assets
       group by upper(btrim(asset_code))
      having count(*) > 1
    ) as grouped;

  if collisions is not null then
    raise exception
      'Cannot add the case-insensitive asset_code index: these codes differ only by case or surrounding spaces: %',
      collisions;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The constraint, then the index
-- ---------------------------------------------------------------------------
-- `drop constraint`, **not** `drop index`. `assets_asset_code_key` is a table
-- constraint, not a bare index — `asset_code text not null unique` in the
-- `create table` above makes it one — and Postgres refuses to drop a
-- constraint's index directly with `2BP01`. The index it backed goes with it,
-- which is the intent: an exact-match uniqueness check that the new index
-- already subsumes would only be a second rule for one fact, and a reader
-- finding both would have to work out which one is doing the work.
alter table public.assets drop constraint assets_asset_code_key;

-- The normalised expression is the key. `upper(btrim(...))` rather than a plain
-- `upper(...)` because the app trims but the database should not depend on that
-- — the check has to hold for a row that arrives by any route, including SQL or
-- an import.
create unique index assets_asset_code_ci_key
  on public.assets (upper(btrim(asset_code)));

comment on index public.assets_asset_code_ci_key is
  'Uniqueness of the asset code ignoring case and surrounding whitespace. Replaces assets_asset_code_key, which was exact-match and therefore let AST-0001 and ast-0001 coexist.';