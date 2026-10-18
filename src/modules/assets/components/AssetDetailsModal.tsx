import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { EyeIcon, PencilIcon } from "@/icons";

import { getAssetHistory } from "@/modules/assets/services/assetService";
import type {
  Asset,
  AssetHistoryEntry,
  AssetMaintenanceEntry,
} from "@/modules/assets/services/assetService";

/**
 * One asset's past: every time it went out, and every service recorded against it.
 *
 * ## Why this is a component and not part of `AssetListPage`
 *
 * Same reason `PrintSettingPanel` is its own file and `AssetLabelModal` is too: a modal
 * that owns a fetch is a component. `AssetListPage` is already ~2,900 lines and is
 * already holding a five-tab form; a dialog with its own loading and error states inlined
 * into it would be the thing nobody could change later.
 *
 * ## Why it exists at all
 *
 * The row menu's edit item was labelled **"Edit details"** and opened the full edit form —
 * a read-only-sounding name on an action that writes, on a form that is nearly thirty
 * fields. There was no way to ask "who had this, and when?" except by opening the
 * handover list and searching. This is that answer, on the row it belongs to.
 *
 * ## What it deliberately does not show
 *
 * **The asset's own fields.** "What is this thing" is the edit form's job, and a dialog
 * carrying both would have two places to read a name from — one of which goes stale the
 * moment somebody saves an edit. The header carries the name and code as an anchor, and
 * those are read from the live `assets` list by id rather than stored, so they cannot
 * disagree with the row the dialog was opened from.
 *
 * **Anything the reader is not allowed to see.** Nothing here is gated by a UI check:
 * `assignments_select_own_department_or_admin` and `profiles_select_own_or_admin` decide
 * the rows and the issuer embed, so a staff member sees a complete history for an asset
 * in their own department but a blank issuer for a colleague's handover. That renders as
 * a dash rather than an empty cell.
 */
/**
 * The loaded history, stamped with the asset it belongs to.
 *
 * **The `assetId` is the whole trick**, and it is the pattern `AssetLabelModal` uses for
 * its preview: the stamp is what lets the render tell "still loading" from "loaded, but
 * for the asset this dialog used to be open on". Without it, reopening the dialog for a
 * second asset would show the first one's history until the fetch came back.
 *
 * Deriving that during render is also what avoids a `setState` in the effect body,
 * which `react-hooks/set-state-in-effect` rejects — and it is more than a lint
 * dodge: clearing the state in the effect would paint a "loading" frame over a dialog
 * whose entire job is to show what is known.
 */
type HistoryState = {
  assetId: string;
  status: "loading" | "ready" | "failed";
  handovers: AssetHistoryEntry[];
  maintenance: AssetMaintenanceEntry[];
};

export default function AssetDetailsModal({
  asset,
  isOpen,
  onClose,
  onEdit,
  canEdit,
}: {
  asset: Asset;
  isOpen: boolean;
  onClose: () => void;
  /** Opens the edit form. The parent closes this dialog first — see the note on the prop. */
  onEdit: () => void;
  /**
   * Whether this reader may edit, from the same `canEditAssets` that gated the menu item
   * this button replaced.
   *
   * A UI gate rather than the boundary: `assets_update_own_unit_or_admin` and
   * `assets_write_admin` are. Hiding it is so a read-only reader is not offered a
   * five-tab form whose save would be refused.
   */
  canEdit: boolean;
}) {
  const { t } = useTranslation("common", { keyPrefix: "assets.details" });

  const [history, setHistory] = useState<HistoryState | null>(null);

  /**
   * Fetched per asset id, and **nothing is reset here on purpose.**
   *
   * The parent mounts this only while an asset id exists, so every open is a fresh
   * mount and the state is already empty — writing it again would be a synchronous
   * `setState` in the effect body for nothing, and would flash a loading frame over a
   * dialog that is only asked to show what is known.
   *
   * A `cancelled` flag covers the sign-out race every other read in this module handles:
   * otherwise the unmounted component sets state for a dialog nobody will see.
   */
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    void getAssetHistory(asset.id).then(
      (result) => {
        if (cancelled) return;
        setHistory({
          assetId: asset.id,
          status: "ready",
          handovers: result.handovers,
          maintenance: result.maintenance,
        });
      },
      () => {
        if (cancelled) return;
        setHistory({
          assetId: asset.id,
          status: "failed",
          handovers: [],
          maintenance: [],
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [asset.id, isOpen]);

  if (!isOpen) return null;

  /** Null means "nothing loaded for THIS asset yet" — which is what loading looks like. */
  const state = history?.assetId === asset.id ? history : null;
  const handovers = state?.handovers ?? [];
  const maintenance = state?.maintenance ?? [];
  const openCount = handovers.filter((row) => row.returnedAt === null).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-2xl">
      <div className="p-6">
        {/* The header icon is the SAME glyph as the menu item that opened this dialog,
            and that is the point rather than a flourish: an icon reappearing where the
            click was is what ties the two together for someone who has just scanned a
            menu rather than a page. `EyeIcon` also stays honest about what the dialog
            does, which is show — every field in it is read-only.

            Muted rather than brand-coloured, so it does not compete with the asset code
            beside it: that is the thing being read. */}
        <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          <EyeIcon className="size-5 shrink-0 text-gray-400 dark:text-gray-500" />
          <span>{asset.asset_code}</span>
          <span className="font-normal text-gray-500 dark:text-gray-400">
            {asset.name}
          </span>
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("hint")}
        </p>

        {state === null ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            {t("loading")}
          </p>
        ) : state.status === "failed" ? (
          /* An empty list and a failed read look identical on screen, and they mean
             opposite things: "this asset has never gone out" versus "we do not know".
             The second must not be rendered as the first. */
          <p className="mt-4 text-sm text-error-600 dark:text-error-500">
            {t("failed")}
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge size="sm" color={openCount > 0 ? "warning" : "light"}>
                {t("summary", { handovers: handovers.length, open: openCount })}
              </Badge>
              {handovers.length === 0 && maintenance.length === 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("none")}
                </span>
              )}
            </div>

            <section className="mt-5">
              <h4 className="text-sm font-medium text-gray-800 dark:text-white/90">
                {t("handoversTitle")}
              </h4>

              {handovers.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  {t("handoversEmpty")}
                </p>
              ) : (
                <ol className="mt-2 space-y-3">
                  {handovers.map((row) => (
                    <HistoryCard key={row.id} row={row} />
                  ))}
                </ol>
              )}
            </section>

            <section className="mt-6">
              <h4 className="text-sm font-medium text-gray-800 dark:text-white/90">
                {t("maintenanceTitle")}
              </h4>

              {maintenance.length === 0 ? (
                /* Said plainly rather than left blank. This section is empty for every
                   asset in the system today — nothing in `src/` schedules a repair — and
                   an empty heading reads as a panel that failed to load. */
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  {t("maintenanceEmpty")}
                </p>
              ) : (
                <ol className="mt-2 space-y-3">
                  {maintenance.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800"
                    >
                      <div className="flex items-center gap-2">
                        <Badge size="sm" color="light">
                          {t(`maintenanceType.${row.type}`)}
                        </Badge>
                        <Badge
                          size="sm"
                          color={
                            row.status === "completed" ? "success" : "light"
                          }
                        >
                          {t(`maintenanceStatus.${row.status}`)}
                        </Badge>
                      </div>
                      {row.description && (
                        <p className="mt-2 text-gray-600 dark:text-gray-300">
                          {row.description}
                        </p>
                      )}
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 sm:grid-cols-4 dark:text-gray-400">
                        <Field
                          label={t("scheduled")}
                          value={formatDate(
                            row.scheduledDate,
                            t("notRecorded"),
                          )}
                        />
                        <Field
                          label={t("completed")}
                          value={formatDate(row.completedAt, t("notRecorded"))}
                        />
                        <Field
                          label={t("vendor")}
                          value={row.vendor ?? t("notRecorded")}
                        />
                        <Field
                          label={t("cost")}
                          value={formatCost(row.cost, t("notRecorded"))}
                        />
                      </dl>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          {/* Edit sits beside Close rather than at the top of the dialog. The history
              is what the dialog is for, and the edit form is a five-tab screen reached
              *after* reading it — putting Edit in the header offered it before the
              history had been looked at, which is the order the old menu item forced too.

              Rightmost so it reads as the primary action, because for a reader who
              opened Details to change something it is the one they came to do. */}
          {canEdit && (
            <Button
              onClick={onEdit}
              startIcon={<PencilIcon className="size-4" />}
            >
              {t("editAsset")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * One handover, as a row in the history.
 *
 * A card rather than a table row because the fields are a mix of one bold line and a
 * wrapped list, and a four-column table would either truncate the accessory list or
 * squeeze the dates into a column each.
 */
function HistoryCard({ row }: { row: AssetHistoryEntry }) {
  const { t } = useTranslation("common", { keyPrefix: "assets.details" });

  const isOut = row.returnedAt === null;

  return (
    <li className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
      <div className="flex flex-wrap items-center gap-2">
        <Badge size="sm" color={isOut ? "warning" : "light"}>
          {isOut ? t("stillOut") : t("returned")}
        </Badge>
        {/* Only when it happened. A transfer badge on every row would be noise, and it is
            the one thing here that explains why this device is with a different person
            than the row above it. */}
        {row.transferredTo && (
          <Badge size="sm" color="info">
            {t("transferred")}
          </Badge>
        )}
        <span className="font-medium text-gray-800 dark:text-white/90">
          {row.holderName ?? t("unknownHolder")}
        </span>
        {row.holderPosition && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {row.holderPosition}
          </span>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 sm:grid-cols-4 dark:text-gray-400">
        <Field label={t("issuedTo")} value={formatDate(row.issuedAt, "—")} />
        <Field
          label={t("returnedOn")}
          value={formatDate(row.returnedAt, "—")}
        />
        <Field
          label={t("condition")}
          value={
            row.conditionAtHandover
              ? t(`conditionAtHandover.${row.conditionAtHandover}`)
              : t("notRecorded")
          }
        />
        {/* The issuer is nullable by RLS for a staff reader, so the dash is a real
            outcome here rather than a missing value. */}
        <Field label={t("recordedBy")} value={row.issuerName ?? "—"} />
      </dl>

      {row.holderDepartmentName && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("departmentLabel")}: {row.holderDepartmentName}
        </p>
      )}

      {row.accessories.length > 0 && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
          <span className="text-gray-500 dark:text-gray-400">
            {t("accessoriesLabel")}:{" "}
          </span>
          {/* Inline, comma-separated. These are the items the signed paper lists, and a
              list of chips here would be a second layout for the same handful of words. */}
          {row.accessories
            .map((item) =>
              item.serialNumber
                ? `${item.name} (${item.serialNumber})`
                : item.name,
            )
            .join(", ")}
        </p>
      )}

      {row.notes && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
          <span className="text-gray-500 dark:text-gray-400">
            {t("notesLabel")}:{" "}
          </span>
          {row.notes}
        </p>
      )}
    </li>
  );
}

/** One labelled value in a `dl`. `dl` rather than a grid of `div`s, so it reads as data. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="mt-0.5 text-gray-700 dark:text-gray-200">{value}</dd>
    </div>
  );
}

/**
 * A timestamp as a plain local date, and a date column as the same shape.
 *
 * Both arrive as ISO strings and both are shown as a **date**, not a date-time: this is
 * a register an admin reads to answer "when was this out", and the hour it changed hands
 * is not the question. `null` becomes the em dash, which is the same fallback the rest
 * of the module uses for an absent value.
 */
function formatDate(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleDateString();
}

/**
 * Money to two decimals.
 *
 * **The column is `numeric (14, 2)` and PostgREST sends it as a JSON number**, so
 * `1500.00` arrives as `1500` and `1500.50` as `1500.5` — printing it raw would show
 * `1500.5` for an amount recorded to the cent. `toLocaleString` restores the two
 * decimals and groups the thousands, which is the difference between a cost and a
 * number somebody typed.
 *
 * No currency symbol: `maintenance.cost` carries no currency column, and inventing one
 * would be a guess printed as a fact. An amount with no unit is still better than
 * `1500.5`.
 */
function formatCost(value: number | null, fallback: string): string {
  if (value === null || Number.isNaN(value)) return fallback;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
