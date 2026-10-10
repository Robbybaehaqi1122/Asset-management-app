-- An accessory's own serial number.
--
-- ## Why this column exists
--
-- A bag and a charger share their laptop's `asset_code` \u2014 `assets_asset_code_ci_key` is
-- unique over `upper(btrim(asset_code))`, and that is what makes the code a usable
-- identifier. So a kit is one `assets` row and the other items hang off the handover.
--
-- What the code cannot carry is the accessory's **own** serial, and the reference
-- document needs it. `261006-NOTEBOOK-OP-PRANOTO.pdf` prints the tag column like this:
--
-- ```
-- 1 Dell Latitude 5450              J9BLPB4 / 2601101047   <- the device
-- 2 AC Adapter Dell Latitude 5450   0VFHDX / 2601101047    <- the adapter's own serial
-- 3 Dell Notebook Bag               -                      <- nothing to print
-- ```
--
-- So the accessory inherits the device's asset code and adds its own serial in front of
-- it, and an accessory with no serial prints a dash rather than the bare code. Without
-- a column to hold it, the adapter row would print `2601101047` and a reader could not
-- tell it from the laptop's own entry.
--
-- ## Nullable, with no backfill
--
-- Nullable because most accessories have no serial \u2014 a bag rarely does, and the
-- reference document's own bag row is a dash. There is nothing to carry across either:
-- this column did not exist, so every existing row is simply `null`, which is the same
-- thing as "no serial number".
--
-- No uniqueness constraint, and deliberately so. Two accessories in the same kit
-- sharing a serial is possible \u2014 two identical chargers from one box \u2014 and a
-- `unique` would refuse a true statement about the physical world.

alter table public.assignments_accessories
    add column serial_number text;

comment on column public.assignments_accessories.serial_number is
  'This item''s own serial number, where it has one \u2014 an adapter''s, a spare
   battery''s. Printed in front of the device''s asset code on the handover document,
   because the accessory shares the device''s code by design. A bag usually has no
   serial, and the document prints a dash for those; null is not an error.';

-- Blank is refused rather than stored, because "serial number: " on a signed document
-- is a field that looks filled and is not. The service trims and sends null for an
-- empty box before this ever sees it.
alter table public.assignments_accessories
    add constraint assignments_accessories_serial_number_not_blank
      check (serial_number is null or btrim(serial_number) <> '');

-- ---------------------------------------------------------------------------
-- What this migration deliberately does not do
-- ---------------------------------------------------------------------------
--
-- - It does not copy the device's serial onto its accessories. Those are different
--   objects with different serials; an adapter's serial is not its laptop's, and
--   repeating the laptop's would make two different objects look like one.
-- - It does not make the serial unique. See above.
-- - It does not add a quantity. The device's Qty stays print-form state for the same
--   reason it always has: a handover row *is* one asset, and an accessory line is one
--   item.