import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Label from "@/components/form/Label";
import Checkbox from "@/components/form/input/Checkbox";
import Input from "@/components/form/input/InputField";
import Select from "@/components/form/Select";
import HandoverPrintModal from "@/modules/handover/components/HandoverPrintModal";
import TextArea from "@/components/form/input/TextArea";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useModal } from "@/hooks/useModal";
import { CloseIcon, HorizontaLDots, PlusIcon } from "@/icons";
import type {
  AssetCondition,
  AssetUnit,
} from "@/modules/assets/services/assetService";
import { ASSET_DEPARTMENTS } from "@/modules/assets/services/assetService";

import {
  deleteHandover,
  getHandovers,
  findUnavailableAssets,
  getHandoverTargets,
  getHandoverUserOptions,
  getOwnHandoverUserIds,
  isAlreadyHandedOverError,
  isUnavailableAssetError,
  issueHandover,
  returnHandover,
  HandoverOpenError,
  NoAssetsSelectedError,
  NoRowsWrittenError,
} from "../services/handoverService";
import type {
  Handover,
  HandoverTarget,
  HandoverUserOption,
} from "../services/handoverService";
import { groupIntoBatches } from "../services/handoverBatches";
import type { HandoverBatch } from "../services/handoverBatches";

type IssueForm = {
  /**
   * The assets going out together, as ids.
   *
   * A list rather than a single id, and the database was always the thing that
   * allowed it: `assignments_one_open_per_asset` is unique *per asset*, so one
   * `user_id` holding three assets was legal from the first migration. The form
   * was the only thing forcing one device at a time.
   *
   * Order is preserved so the notice can name what went out in the order it was
   * picked, and so a batch is built the way it was read.
   */
  assetIds: string[];
  userId: string;
  dueDate: string;
  /**
   * One value for the whole batch, or `""` for none of them.
   *
   * See `HandoverInput.conditionAtHandover` for why this is not per asset.
   */
  conditionAtHandover: string;
  notes: string;
};

const EMPTY_ISSUE: IssueForm = {
  assetIds: [],
  userId: "",
  dueDate: "",
  conditionAtHandover: "",
  notes: "",
};

/** The unit the page opens on, before anyone picks another. */
const DEFAULT_UNIT: AssetUnit = ASSET_DEPARTMENTS[0];

/**
 * Asset handover: one list, with the unit as a filter inside it.
 *
 * **One page rather than one per unit**, which is the reverse of `/assets` and
 * `/assets-hsse` on purpose. Those two pages *write* an asset and pick a
 * completely different fieldset per unit, so one route per unit is what stops an
 * HSSE row being created from the IT page and then vanishing from it. Handover
 * records nothing that varies by unit — it is one list of who is holding what —
 * so splitting it bought a second page rather than a distinction. The unit here
 * is a *view* of the same rows, which is what a filter is for.
 *
 * **The filter is in SQL, not the browser.** Changing the unit re-runs
 * `getHandovers`, exactly as `/asset-settings` re-runs its category read. The
 * unit is not a refinement over an already-downloaded list: an admin who has
 * handed over assets in both units would otherwise download both lists to look at
 * one of them, and the browser-side `visible` memo below would have to be
 * re-taught about the unit on top of the search and the status filter.
 *
 * `ASSET_DEPARTMENTS` is the same closed pair the asset routes serve, so the
 * dropdown offers exactly the two units this module can be useful for. It is
 * *not* fed from `getCategoryUnits` the way `/asset-settings` is: that list is
 * for category management and grows with the `departments` table, whereas a unit
 * here means "which assets are on loan", and a unit with categories but no
 * handover route has no handover to show. IT/HSSE is the honest list.
 *
 * **Not gated on `isAdmin`, unlike `/users` and `/departments`.** A staff member
 * has something real to do here: see what they are holding and return it.
 * `assignments_select_own_or_admin` decides the rows, and
 * `assignments_update_own_or_admin` lets them return their own. Gating the read
 * would take that away and hand them an empty page instead.
 *
 * Which buttons appear is a UI convenience, never the enforcement point — the
 * policies already refuse everything a staff member cannot do. What the gate
 * buys is not showing a control that cannot work.
 */
export default function HandoverListPage() {
  const { t } = useTranslation("common", { keyPrefix: "handover" });
  const { user, profile } = useAuth();
  const isAdmin = useIsAdmin();

  /**
   * `IT` rather than a value read from the URL, because there is one route and
   * nothing to read it from. It is the same default `AssetSettingsPage` opens on,
   * so the two screens agree on what "the unit" means before anything is picked.
   */
  const [unit, setUnit] = useState<AssetUnit>(DEFAULT_UNIT);

  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const issueModal = useModal();
  const deleteModal = useModal();
  const detailModal = useModal();
  /**
   * The handover whose document is open, or null.
   *
   * A single id rather than a boolean because the modal has to know **which** row to
   * read — one handover row is one device, and the document is the whole batch that
   * row belongs to.
   */
  const [printHandoverId, setPrintHandoverId] = useState<string | null>(null);

  /**
   * The batch whose asset list is open, or null.
   *
   * The **batch**, not a row id: the menu item opens a list of what went out
   * together, which is a group. Reading it back off `batches` on render rather than
   * copying it into state means a Return taken while the modal is open cannot leave
   * a stale copy of a device listed as still out.
   */
  const [detailBatchKey, setDetailBatchKey] = useState<string | null>(null);

  const [issueForm, setIssueForm] = useState<IssueForm>(EMPTY_ISSUE);
  const [targets, setTargets] = useState<HandoverTarget[]>([]);
  const [people, setPeople] = useState<HandoverUserOption[]>([]);

  /**
   * The roster rows belonging to the signed-in account, for the Return button.
   *
   * Read once per load rather than derived, because `row.userId` is a
   * `handover_users` id and the account's id is an auth id — comparing them
   * client-side is false for every row. See `getOwnHandoverUserIds`.
   */
  const [ownUserIds, setOwnUserIds] = useState<ReadonlySet<string>>(new Set());
  /** Bumped per modal open so the `Select` primitives remount with fresh state. */
  const [formToken, setFormToken] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<Handover | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Which row's action menu is open, or null.
   *
   * One id at the page rather than a `useState` per row, for the same reason
   * `UserListPage` does it: a boolean per row would mean a component per row just
   * to hold it, and only one menu can usefully be open anyway.
   */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((prev) => prev + 1), []);

  useEffect(() => {
    // `cancelled` covers a sign-out or a unit change landing while the read is in
    // flight, which would otherwise set rows for a screen that is no longer shown.
    let cancelled = false;

    void getHandovers(unit).then(
      (rows) => {
        if (cancelled) return;
        setHandovers(rows);
        setLoadFailed(false);
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        setHandovers([]);
        setLoadFailed(true);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [reloadToken, unit]);

  /**
   * Loaded separately from the list, and a failure is silent on purpose.
   *
   * This only decides whether the Return button is *offered*. If it fails the set
   * is empty, so a staff member sees no Return button and RLS would have refused
   * the write anyway — the same state, reached honestly. Surfacing an error banner
   * for it would imply something is broken when the only consequence is a missing
   * convenience.
   */
  useEffect(() => {
    let cancelled = false;

    void getOwnHandoverUserIds().then(
      (ids) => {
        if (cancelled) return;
        setOwnUserIds(new Set(ids));
      },
      () => {
        if (cancelled) return;
        setOwnUserIds(new Set());
      },
    );

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  /**
   * Both pickers are loaded when the modal opens, not on mount.
   *
   * Not because they are admin-only any more — that was the old reason, and it
   * stopped being true in `02000`. `getAllUsers` read `profiles`, which RLS
   * refuses for a staff member, so the people list had to be gated and could only
   * be fetched by an admin. `getHandoverUserOptions` reads `handover_users`,
   * which every signed-in user may read, so it is loaded the same lazy way for a
   * different reason: the Issue button is still admin-only, so nobody else opens
   * this modal, and two requests on every visit of a screen they cannot use is a
   * cost with no return.
   */
  const handleOpenIssue = async () => {
    setSaveError(null);
    setIssueForm(EMPTY_ISSUE);
    setFormToken((prev) => prev + 1);
    issueModal.openModal();
    setIsSaving(true);
    try {
      const [assetRows, roster] = await Promise.all([
        getHandoverTargets(unit),
        // Reference data, not accounts: name and position, in that order, because
        // a roster of twenty people called by first name alone is unreadable.
        getHandoverUserOptions(),
      ]);
      setTargets(assetRows);
      setPeople(roster);
    } catch {
      setTargets([]);
      setPeople([]);
      setSaveError(t("errors.pickers"));
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * The snapshot starts as the asset's own condition and can be overridden.
   *
   * The default is not cosmetic: `assets_guard_status` refuses a status a client
   * writes that disagrees with the loans, but `assets.condition` is a free
   * column an admin can edit, so the condition of an asset at the moment it goes
   * out is a fact the handover has to record for itself. Prefilling it means the
   * common case is one click and nobody has to remember.
   */
  /**
   * The assets currently ticked, in the order they were picked.
   *
   * Derived rather than stored twice: `issueForm.assetIds` holds the ids, and the
   * rows are looked up here so the list cannot show an asset that is not in it.
   */
  const selectedTargets = useMemo(
    () =>
      issueForm.assetIds
        .map((id) => targets.find((row) => row.id === id))
        .filter((row): row is HandoverTarget => row !== undefined),
    [issueForm.assetIds, targets],
  );

  /**
   * Every document number in the batch, as one line.
   *
   * Read-only either way, and with several assets there is no single number to
   * show — so this lists the distinct ones. An asset with no document number is
   * named so its absence is visible rather than silently shortening the list: the
   * admin handed over three things and can see that one of them has no document
   * number on file, which is exactly the thing worth noticing.
   */
  const batchDocNo = useMemo(() => {
    const withDoc = [
      ...new Set(
        selectedTargets
          .map((row) => row.handoverDocNo)
          .filter((value): value is string => value !== null && value !== ""),
      ),
    ];
    const withoutDoc = selectedTargets.filter(
      (row) => !row.handoverDocNo,
    ).length;

    if (withDoc.length === 0 && withoutDoc === 0) return null;
    return {
      numbers: withDoc,
      withoutDoc,
    };
  }, [selectedTargets]);

  /**
   * The roster entry chosen in the issue form, so its department can be shown
   * beside the name. The picker label already carries the position; the department
   * is the third fact that disambiguates two people with the same name, and there
   * is no room for it in a single-line option.
   */
  const selectedPerson = people.find((row) => row.id === issueForm.userId);

  /**
   * The signed-in account, which becomes `assignments.assigned_by`.
   *
   * This is the **issuer** and it is deliberately not a roster entry. The
   * recipient is `handover_users`; who pressed the button is `profiles`, and the
   * two only happened to be the same column before `02000`.
   *
   * `profile?.full_name` is preferred over `user.email` for the same reason
   * `UserDropdown` does it: `email` is the auth identity and reads as a login
   * rather than a name, and this string ends up in the list's "recorded by"
   * column permanently.
   */
  const issuerName = profile?.full_name || user?.email || "";

  /**
   * Add or remove one asset from the batch.
   *
   * **The condition snapshot is recomputed from the whole selection, not from the
   * box just clicked.** Prefilling on a single toggle would leave the field
   * showing the condition of whichever asset was picked last, which reads as "this
   * is the condition of the batch" and is not true whenever the assets disagree.
   *
   * So the rule is one sentence and it is enforced here rather than trusted:
   * prefill only when every selected asset agrees, blank otherwise. Two assets
   * both `good` prefill `good`; add a `fair` one and the field clears rather than
   * silently claiming a shared value. The admin can still type one value to
   * deliberately record across the batch — that is a choice, and this is what
   * keeps it from looking like an accident.
   */
  const handleToggleAsset = (assetId: string) => {
    setIssueForm((prev) => {
      const assetIds = prev.assetIds.includes(assetId)
        ? prev.assetIds.filter((id) => id !== assetId)
        : [...prev.assetIds, assetId];

      const conditions = new Set(
        assetIds
          .map((id) => targets.find((row) => row.id === id)?.condition)
          .filter((value): value is AssetCondition => value !== undefined),
      );

      return {
        ...prev,
        assetIds,
        conditionAtHandover: conditions.size === 1 ? [...conditions][0] : "",
      };
    });
  };

  const handleSelectAllAssets = () => {
    setIssueForm((prev) => {
      const assetIds = targets.map((row) => row.id);
      const conditions = new Set(targets.map((row) => row.condition));
      return {
        ...prev,
        assetIds,
        conditionAtHandover: conditions.size === 1 ? [...conditions][0] : "",
      };
    });
  };

  const handleClearAssets = () => {
    setIssueForm((prev) => ({
      ...prev,
      assetIds: [],
      conditionAtHandover: "",
    }));
  };

  const handleIssue = async () => {
    if (issueForm.assetIds.length === 0) {
      setSaveError(t("errors.assetRequired"));
      return;
    }
    if (issueForm.userId === "") {
      setSaveError(t("errors.personRequired"));
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const created = await issueHandover({
        assetIds: issueForm.assetIds,
        userId: issueForm.userId,
        issuedBy: user?.id ?? "",
        dueDate: issueForm.dueDate || null,
        conditionAtHandover: (issueForm.conditionAtHandover ||
          null) as AssetCondition | null,
        notes: issueForm.notes,
      });
      issueModal.closeModal();
      // Counted from the rows that came back rather than from the ids that went
      // out: the batch is all-or-nothing, so the two agree — but counting the
      // response means the notice can never claim more handovers than exist.
      setNotice(
        created.length === 1
          ? t("issued")
          : t("issuedMany", { count: created.length }),
      );
      reload();
    } catch (error) {
      // Three refusals worth telling apart, all from the database rather than from
      // a check here.
      //
      // `23514` is an asset not being available — retired, damaged, already out,
      // or in maintenance — and with a batch it names a bare uuid the admin cannot
      // match to anything on screen. So the message is followed by one extra read
      // that resolves those ids back to asset codes. That read is deliberately
      // **after** the failure and never before the insert: a pre-check would be a
      // second source of truth that a second admin can invalidate between the two,
      // whereas the trigger is the boundary.
      if (error instanceof NoAssetsSelectedError) {
        // Reachable only if the button were pressed with nothing ticked, which the
        // guard above the button is meant to stop. Kept anyway: the service
        // refusing an empty batch is what makes "the service reported success for
        // nothing" impossible, and swallowing that here would undo the point.
        setSaveError(t("errors.assetRequired"));
      } else if (isUnavailableAssetError(error)) {
        try {
          const gone = await findUnavailableAssets(issueForm.assetIds, unit);
          setSaveError(
            gone.length === 0
              ? t("errors.notAvailable")
              : t("errors.notAvailableNamed", {
                  assets: gone.map((row) => row.assetCode).join(", "),
                }),
          );
        } catch {
          setSaveError(t("errors.notAvailable"));
        }
      } else if (isAlreadyHandedOverError(error)) {
        setSaveError(t("errors.alreadyHandedOver"));
      } else {
        setSaveError(t("errors.issue"));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleReturn = async (row: Handover) => {
    setIsSaving(true);
    try {
      await returnHandover(row.id);
      setNotice(t("returned", { name: assetLabel(row, t("fields.unknown")) }));
      reload();
    } catch (error) {
      setNotice(
        error instanceof NoRowsWrittenError ? t("errors.returnDenied") : null,
      );
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * One entry per **batch**, not per row.
   *
   * `getHandovers` returns one row per asset, because a handover *is* one asset —
   * that is what makes returning the laptop but keeping the mouse a real operation
   * rather than a workaround. But **one batch of assets to one recipient is one
   * printed document**: `getHandoverDocument` finds the batch by
   * `(user_id, assigned_by, assigned_at)`, the three values that are identical
   * across every row written by one multi-row insert.
   *
   * Rendering rows ungrouped therefore showed N rows for N assets and **no way to
   * tell which one to print**, even though every one of them prints the same
   * document. With batches accumulating that became worse, not better: the longer the
   * list, the less any single row could be pointed at as "the document". So the
   * table lists batches and names the assets inside one, which is also the shape of
   * the paper.
   */
  const batches = useMemo(() => groupIntoBatches(handovers), [handovers]);

  /**
   * The batch whose detail list is open.
   *
   * Derived from `batches` on every render rather than copied into state, because a
   * copy would go stale: return an asset while the list is open and the copy would
   * still show it as out. The state holds only **which** batch, and the group is
   * looked up by key.
   */
  const detailBatch = useMemo(
    () =>
      detailBatchKey === null
        ? null
        : (batches.find((batch) => batch.key === detailBatchKey) ?? null),
    [batches, detailBatchKey],
  );

  /**
   * Whether the signed-in caller may return a device in the **open** batch.
   *
   * Resolved here rather than passed into the modal, because the modal is rendered
   * once for the page while the batch it shows changes. The test is the **roster id**
   * against `ownUserIds` — never `batch.userId === user?.id`, which went false for
   * every row once `user_id` moved onto `handover_users` in `02000`.
   */
  const detailCanReturn =
    detailBatch !== null &&
    (isAdmin || ownUserIds.has(detailBatch.seed.userId));

  /**
   * Opens the asset list for one batch.
   *
   * **A modal rather than an expandable row.** Expanding in place was the other
   * option and it is worse for the case that motivated this: a batch of ten devices
   * pushes the row to ten lines, so every batch *below* it moves off the screen and
   * the admin loses the list they were reading to check one asset. A modal is also
   * the shape every other drill-down on this page already takes.
   */
  const handleOpenDetail = (batch: HandoverBatch) => {
    setDetailBatchKey(batch.key);
    detailModal.openModal();
  };

  const handleOpenDelete = (row: Handover) => {
    setDeleteError(null);
    setPendingDelete(row);
    deleteModal.openModal();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    setIsSaving(true);
    setDeleteError(null);
    try {
      await deleteHandover(pendingDelete.id);
      deleteModal.closeModal();
      setNotice(t("deleted"));
      reload();
    } catch (error) {
      if (error instanceof HandoverOpenError) {
        setDeleteError(t("errors.open"));
      } else {
        setDeleteError(t("errors.delete"));
      }
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Filtering happens in the browser over the rows already fetched, the same
   * approach the asset and user lists take. The unit is the one thing that is
   * filtered in SQL, and that is because it is the page, not a filter on it.
   *
   * **Grouping happens after the status filter, not before it**, and that order is
   * load-bearing: a batch can be half returned, and filtering rows first then
   * grouping would render such a batch as if all of it were out.
   */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return batches.filter((batch) => {
      // "open" means **anything still out**, which is the only reading that keeps a
      // half-returned batch findable. The alternative — a batch is open only if all
      // of it is — hides it from the filter an admin would use to find the mouse they
      // still owe.
      if (statusFilter === "open" && batch.openCount === 0) return false;
      if (statusFilter === "returned" && batch.openCount > 0) return false;
      if (needle === "") return true;

      // Searched over the assets too, so finding a batch by one of its asset codes
      // works even though the row shows a joined list rather than one asset.
      const haystack = [
        personLabel(batch.holder, t("fields.unknown")),
        issuerLabel(batch.issuedBy, t("fields.unknown")),
        batch.dueDate ?? "",
        ...batch.docNumbers,
        ...batch.items.map((row) => assetLabel(row, t("fields.unknown"))),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [batches, search, statusFilter, t]);

  const statusOptions = [
    { value: "", label: t("filters.all") },
    { value: "open", label: t("status.open") },
    { value: "returned", label: t("status.returned") },
  ];

  /**
   * The unit dropdown, from the same closed pair the asset routes serve rather
   * than from `getCategoryUnits`.
   *
   * `ASSET_DEPARTMENTS` is imported rather than retyped so a unit added there
   * appears here without a second edit, and so this list cannot drift from the
   * pair the asset form is built for. `AssetSettingsPage` deliberately does *not*
   * use this list — its filter is for category management and grows with the
   * `departments` table, which is a different question from "which assets are on
   * loan".
   */
  const unitOptions = ASSET_DEPARTMENTS.map((value) => ({
    value,
    label: t(`units.${value}`),
  }));

  const conditionOptions = [
    { value: "", label: t("fields.conditionPlaceholder") },
    ...(["new", "good", "fair", "poor", "broken"] as AssetCondition[]).map(
      (value) => ({ value, label: t(`condition.${value}`) }),
    ),
  ];

  return (
    <div>
      <PageMeta
        title={`${t("pageTitle")} | Asset Management App`}
        description={t("pageDescription")}
      />
      <PageBreadcrumb pageTitle={t("pageTitle")} />

      {/* Outside any modal, for the same reason the user list's warnings are: the
          outcome is raised after the modal has closed, and `Modal` returns null
          while closed, so a message rendered in there would never be seen. */}
      {notice && (
        <div
          role="status"
          className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-white/5 dark:text-gray-300"
        >
          <p>{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t("dismiss")}
            className="shrink-0 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/3">
        <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {t("pageTitle")}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("subtitle")}
            </p>
          </div>

          {/* Admin only, and hidden rather than disabled: a staff member has no
              use for it and `assignments_insert_admin` refuses it. */}
          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => void handleOpenIssue()}
              startIcon={<PlusIcon className="size-4" />}
            >
              {t("issue")}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-3 border-b border-gray-200 p-6 sm:flex-row sm:items-end dark:border-gray-800">
          <div className="flex-1">
            <Label htmlFor="handover-search">{t("filters.search")}</Label>
            <Input
              id="handover-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("filters.searchPlaceholder")}
              className="mt-1"
            />
          </div>
          {/* The unit comes before the status filter because it is the coarser of
              the two: it decides which assets can be handed out at all, where the
              status only narrows what is already listed. */}
          <div className="sm:w-48">
            <Label htmlFor="handover-unit">{t("filters.unit")}</Label>
            {/* Keyed on the value: `Select` reads `defaultValue` once, so an
                unkeyed one would keep showing the unit it mounted with after a
                change made anywhere else. */}
            <Select
              key={`unit-${unit}`}
              id="handover-unit"
              className="mt-1"
              options={unitOptions}
              defaultValue={unit}
              onChange={(value) => setUnit(value as AssetUnit)}
            />
          </div>
          <div className="sm:w-56">
            <Label htmlFor="handover-status">{t("filters.status")}</Label>
            {/* Keyed on the value: `Select` reads `defaultValue` once, so a
                filter that changed elsewhere would keep showing the old one. */}
            <Select
              key={`status-${statusFilter}`}
              id="handover-status"
              className="mt-1"
              options={statusOptions}
              defaultValue={statusFilter}
              onChange={setStatusFilter}
            />
          </div>
        </div>

        {isLoading ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("loading")}
          </p>
        ) : loadFailed ? (
          <p className="p-6 text-sm text-error-600 dark:text-error-500">
            {t("errors.load")}
          </p>
        ) : visible.length === 0 ? (
          // The empty state names the unit, because "no handover" and "no handover
          // in this department" are different answers — and switching the unit is
          // the fastest way to find out which one the admin is looking at.
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {handovers.length === 0
              ? t("empty", { unit: t(`units.${unit}`) })
              : t("noMatches")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            {/* The count is in **batches**, and the Asset heading is plural, because
                a row is now one document. An admin counting rows to work out how many
                documents they are about to print would get the wrong answer, which
                is the exact confusion this grouping exists to remove. */}
            <p className="px-4 pt-4 text-sm text-gray-500 dark:text-gray-400">
              {t("table.showing", {
                shown: visible.length,
                total: batches.length,
              })}
            </p>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="px-4 py-3 text-start text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("table.asset")}
                  </th>
                  <th className="px-4 py-3 text-start text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("table.holder")}
                  </th>
                  <th className="px-4 py-3 text-start text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("table.handedOverOn")}
                  </th>
                  <th className="px-4 py-3 text-start text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("table.due")}
                  </th>
                  <th className="px-4 py-3 text-start text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("table.status")}
                  </th>
                  <th className="px-4 py-3 text-end text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((batch) => (
                  <tr
                    key={batch.seed.id}
                    className="border-b border-gray-100 align-top dark:border-gray-800"
                  >
                    <td className="px-4 py-3">
                      {/* At most **two** assets are named in the cell, and the rest are
                          behind the Detail menu. Listing all of them was worse the more
                          there were: a batch of ten devices printed ten lines in one
                          table cell, the row grew taller than the screen, and the one
                          thing the row is for — "one row, one document" — became
                          invisible in the pile. Two names plus a count is enough to
                          recognise the batch without turning the row into the list.

                          The button is rendered **whenever anything is hidden**, so a
                          batch of one or two is never given a control that opens a list
                          it does not need. */}
                      {/* Truncated, because a device name is free text and one long
                          name would otherwise stretch the whole table sideways. The
                          wrapper carries the width and the paragraph carries
                          `truncate`, since a `<td>` will not constrain its own
                          children in an auto-layout table. */}
                      <div className="max-w-[22rem]">
                        {batch.items.slice(0, 2).map((row) => (
                          <p
                            key={row.id}
                            className="truncate text-sm font-medium text-gray-800 dark:text-white/90"
                            title={assetLabel(row, t("fields.unknown"))}
                          >
                            {assetLabel(row, t("fields.unknown"))}
                            {row.returnedAt !== null && (
                              <span className="ms-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                                {t("status.returned")}
                              </span>
                            )}
                          </p>
                        ))}
                      </div>
                      {batch.items.length > 2 && (
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(batch)}
                          className="mt-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {t("table.viewAll", { count: batch.items.length })}
                        </button>
                      )}
                      {batch.docNumbers.length > 0 && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {t("table.doc")}: {batch.docNumbers.join(", ")}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {personLabel(batch.holder, t("fields.unknown"))}
                      </p>
                      {/* The third fact about the holder. The position is
                          already in the line above; the department is what
                          remains, and the roster is not unique on name so all
                          three are needed to tell two people apart. */}
                      {batch.holder?.departmentName && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {batch.holder.departmentName}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {formatTimestamp(batch.assignedAt)}
                      </p>
                      {/* Who pressed the button, which is a *different* person
                          from the holder whenever an admin issues a handover to
                          somebody else. `assigned_by` is an account and stays
                          one; only the recipient moved to the roster. */}
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("table.recordedBy")}:{" "}
                        {issuerLabel(batch.issuedBy, t("fields.unknown"))}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {formatDateOnly(batch.dueDate)}
                    </td>
                    <td className="px-4 py-3">
                      {/* A batch can be **partly** returned — the laptop came back and
                          the mouse did not — and the single badge says so rather than
                          rounding it to either extreme. It reads "open" while anything
                          is still out, because that is what an admin filtering by open
                          is asking for. */}
                      {batch.openCount > 0 ? (
                        <Badge size="sm" color="warning">
                          {batch.openCount === batch.items.length
                            ? t("status.open")
                            : t("status.partlyReturned", {
                                open: batch.openCount,
                                total: batch.items.length,
                              })}
                        </Badge>
                      ) : (
                        <Badge size="sm" color="success">
                          {t("status.returned")}
                        </Badge>
                      )}
                      {/* The condition, only when the batch agrees on it. Every row of
                          a batch was written from one form, so a single condition is the
                          normal case; a per-asset editor inside the issue form would be
                          the alternative, and it is not built. */}
                      {batch.items[0]?.conditionAtHandover && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {t(`condition.${batch.items[0].conditionAtHandover}`)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <HandoverBatchActions
                        batch={batch}
                        canDelete={isAdmin}
                        isSaving={isSaving}
                        openMenuId={openMenuId}
                        setOpenMenuId={setOpenMenuId}
                        onDelete={(row) => handleOpenDelete(row)}
                        onPrint={() => setPrintHandoverId(batch.seed.id)}
                        onDetail={() => handleOpenDetail(batch)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* The printable document. Mounted only once an id exists so its data fetch
          cannot fire for a null row on a page that never opened it. */}
      {printHandoverId !== null && (
        <HandoverPrintModal
          handoverId={printHandoverId}
          isOpen
          onClose={() => setPrintHandoverId(null)}
        />
      )}

      <Modal
        isOpen={issueModal.isOpen}
        onClose={issueModal.closeModal}
        className="max-w-md"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {t("issueTitle")}
          </h3>

          <div className="mt-5 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="handover-assets-label">
                  {t("fields.assets")} <span className="text-error-500">*</span>
                </Label>
                {/* Both buttons are absent rather than disabled when there is
                    nothing to act on, so the row never shows two controls that do
                    nothing. "Select all" only appears once something is ticked,
                    because with nothing ticked it and "clear" are the same action. */}
                {targets.length > 1 &&
                  (issueForm.assetIds.length === targets.length ? (
                    <button
                      type="button"
                      onClick={handleClearAssets}
                      className="shrink-0 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      {t("fields.assetsClearAll")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSelectAllAssets}
                      className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                    >
                      {t("fields.assetsSelectAll")}
                    </button>
                  ))}
              </div>

              {/* A checkbox list rather than a `MultiSelect`, and that is a
                  decision rather than an oversight. The asset list is every
                  available asset in the unit — potentially hundreds — and
                  `MultiSelect` has no search, so finding one code means opening a
                  dropdown and scrolling. It also renders its own `<label>` from a
                  string prop, which cannot be tied to this form's `Label` the way
                  every other field here is.

                  A list shows the asset code, the name and the condition together,
                  and the selection is visible without opening anything. */}
              <div
                role="group"
                aria-labelledby="handover-assets-label"
                className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700"
              >
                {targets.length === 0 ? (
                  <p className="p-3 text-sm text-gray-500 dark:text-gray-400">
                    {t("fields.assetPlaceholder")}
                  </p>
                ) : (
                  targets.map((row) => (
                    <label
                      key={row.id}
                      className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/3"
                    >
                      <Checkbox
                        id={`handover-asset-${row.id}`}
                        checked={issueForm.assetIds.includes(row.id)}
                        onChange={() => handleToggleAsset(row.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                          {row.assetCode}
                        </span>
                        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                          {row.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                        {t(`condition.${row.condition}`)}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("fields.assetsHint", { count: issueForm.assetIds.length })}
              </p>
            </div>

            <div>
              <Label htmlFor="handover-person">
                {t("fields.person")} <span className="text-error-500">*</span>
              </Label>
              <Select
                key={`person-${formToken}`}
                id="handover-person"
                className="mt-1"
                options={[
                  { value: "", label: t("fields.personPlaceholder") },
                  ...people.map((row) => ({
                    value: row.id,
                    label: row.label,
                  })),
                ]}
                onChange={(value) =>
                  setIssueForm((prev) => ({ ...prev, userId: value }))
                }
              />
              {/* The department of whoever was just picked. It is in the table
                  behind the modal and it is not in the option label, because a
                  picker line reading "name — position — department" is too long to
                  scan. Showing it here is the third fact, next to the two the
                  label already gave. */}
              {selectedPerson?.departmentName && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("fields.personDepartment")}:{" "}
                  {selectedPerson.departmentName}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("fields.personHint")}
              </p>
            </div>

            {/* Read-only, and deliberately not an editable field. This is the
                account the row will be attributed to, and letting it be chosen
                would let an admin file a handover under somebody else's name —
                the one thing an audit column must not allow. */}
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/5">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("fields.recordedBy")}
              </p>
              <p className="mt-0.5 text-sm font-medium text-gray-800 dark:text-white/90">
                {issuerName}
              </p>
            </div>

            <div>
              <Label htmlFor="handover-condition">
                {t("fields.condition")}
              </Label>
              <Select
                key={`condition-${formToken}`}
                id="handover-condition"
                className="mt-1"
                options={conditionOptions}
                onChange={(value) =>
                  setIssueForm((prev) => ({
                    ...prev,
                    conditionAtHandover: value,
                  }))
                }
              />
            </div>

            <div>
              <Label htmlFor="handover-doc">{t("fields.doc")}</Label>
              {/* Read-only, and never written — `assets.handover_doc_no` is edited
                  on the asset form, and a handover must not overwrite the number
                  the previous handover was recorded under.

                  With several assets there is no single number, so this lists the
                  distinct ones. An asset with no document number is counted
                  rather than dropped, because "one of the three I handed over has
                  no document number on file" is worth noticing and a shorter list
                  would hide it. */}
              <Input
                id="handover-doc"
                value={
                  batchDocNo === null
                    ? ""
                    : [
                        ...batchDocNo.numbers,
                        ...(batchDocNo.withoutDoc > 0
                          ? [
                              t("fields.docMissing", {
                                count: batchDocNo.withoutDoc,
                              }),
                            ]
                          : []),
                      ].join(", ")
                }
                readOnly
                placeholder={t("fields.docPlaceholder")}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("fields.docReadOnlyHint")}
              </p>
            </div>

            <div>
              <Label htmlFor="handover-due">{t("fields.due")}</Label>
              {/* A native date input, not the `DatePicker` primitive: flatpickr
                  owns its input and hands back hook objects rather than a value,
                  so it does not fit a controlled form. A native one is
                  controlled and produces the `YYYY-MM-DD` the `date` column
                  wants. The primitive is still one of the 13 and not dead — it is
                  just the wrong shape for this field. */}
              <input
                id="handover-due"
                type="date"
                value={issueForm.dueDate}
                onChange={(event) =>
                  setIssueForm((prev) => ({
                    ...prev,
                    dueDate: event.target.value,
                  }))
                }
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:focus:border-brand-800"
              />
            </div>

            <div>
              <Label htmlFor="handover-notes">{t("fields.notes")}</Label>
              <TextArea
                id="handover-notes"
                rows={3}
                value={issueForm.notes}
                onChange={(value) =>
                  setIssueForm((prev) => ({ ...prev, notes: value }))
                }
                placeholder={t("fields.notesPlaceholder")}
                className="mt-1"
              />
            </div>
          </div>

          {saveError && (
            <p className="mt-4 text-sm text-error-600 dark:text-error-500">
              {saveError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="outline" onClick={issueModal.closeModal}>
              {t("cancel")}
            </Button>
            {/* Three independent reasons this cannot be submitted, and only two of them are
                knowable before pressing. `people.length === 0` and
                `targets.length === 0` are disabled rather than reported, because
                they are already visible on screen — an empty roster is an empty
                list right there. A **ticked-nothing** batch is different: the
                screen looks filled in and the button says no, which is the
                "control that looks actionable and is not" problem. So that one
                reports itself instead. */}
            <Button
              onClick={() => void handleIssue()}
              disabled={isSaving || targets.length === 0 || people.length === 0}
            >
              {isSaving ? t("saving") : t("issue")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* The asset list for one batch. Reads from `detailBatch`, which is derived from
          `batches` rather than copied, so a device returned while this is open stops
          being listed as out without a reload. */}
      <Modal
        isOpen={detailModal.isOpen}
        onClose={detailModal.closeModal}
        className="max-w-2xl"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {detailBatch === null
              ? t("detailTitle")
              : t("detailTitleWith", {
                  count: detailBatch.items.length,
                  name: personLabel(detailBatch.holder, t("fields.unknown")),
                })}
          </h3>

          {detailBatch !== null && (
            <>
              {/* The batch's own facts, because the question this modal answers is
                  "what exactly went out in *this* handover" — and the recipient and
                  date are what make a list of ten assets unambiguous. */}
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">
                    {t("table.holder")}
                  </dt>
                  <dd className="text-gray-800 dark:text-white/90">
                    {personLabel(detailBatch.holder, t("fields.unknown"))}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">
                    {t("table.handedOverOn")}
                  </dt>
                  <dd className="text-gray-800 dark:text-white/90">
                    {formatTimestamp(detailBatch.assignedAt)}
                  </dd>
                </div>
              </dl>

              {/* The scroll box is here **because** the list can be long. Ten assets
                  is the case that motivated this modal, so a modal that cannot scroll
                  would only have moved the clipping. */}
              <div className="mt-4 max-h-96 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                {detailBatch.items.map((row, index) => {
                  const isReturned = row.returnedAt !== null;
                  return (
                    <div
                      key={row.id}
                      className="flex items-start justify-between gap-3 border-b border-gray-100 px-3 py-2.5 last:border-b-0 dark:border-gray-800"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                          <span className="text-gray-400 dark:text-gray-500">
                            {index + 1}.
                          </span>{" "}
                          {row.asset?.assetCode ?? t("fields.unknown")}
                        </p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {row.asset?.name ?? ""}
                        </p>
                        {/* Serial and condition are the two facts an admin checks
                            against a physical device in the hand. The asset's
                            registered location is **not** here: it is a different fact
                            from what was handed over, and this is a list of what went
                            out. */}
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {row.asset?.serialNumber != null &&
                            row.asset.serialNumber !== "" && (
                              <>
                                {t("table.serial")}: {row.asset.serialNumber}{" "}
                                ·{" "}
                              </>
                            )}
                          {row.conditionAtHandover !== null
                            ? t(`condition.${row.conditionAtHandover}`)
                            : t("fields.conditionPlaceholder")}
                        </p>
                      </div>
                      {/* Return sits **beside the device**, not in the row's dropdown.

                          It was one dropdown item per open device, and at ten devices
                          that was ten entries repeating the names this list already
                          shows — the menu grew past the bottom of the viewport and said
                          nothing the asset list did not. A control that acts on a
                          device belongs next to that device.

                          Still one `handoverId` per press, so returning the laptop while
                          leaving the mouse stays expressible: only where the control
                          lives changed, not its granularity. */}
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Badge
                          size="sm"
                          color={isReturned ? "success" : "warning"}
                        >
                          {isReturned ? t("status.returned") : t("status.open")}
                        </Badge>
                        {!isReturned && detailCanReturn && (
                          <Button
                            variant="outline"
                            disabled={isSaving}
                            onClick={() => void handleReturn(row)}
                            aria-label={t("returnDevice", {
                              name: assetLabel(row, t("fields.unknown")),
                            })}
                          >
                            {t("return")}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                {t("detailHint")}
              </p>
            </>
          )}

          <div className="mt-6 flex justify-end">
            <Button onClick={detailModal.closeModal}>{t("close")}</Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={deleteModal.isOpen}
        onClose={deleteModal.closeModal}
        className="max-w-md"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {t("deleteTitle")}
          </h3>
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            {t("deleteBody")}
          </p>

          {deleteError && (
            <p className="mt-4 text-sm text-error-600 dark:text-error-500">
              {deleteError}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="outline" onClick={deleteModal.closeModal}>
              {t("cancel")}
            </Button>
            <Button
              onClick={() => void handleConfirmDelete()}
              disabled={isSaving}
            >
              {isSaving ? t("deleting") : t("confirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * `asset_code — name`, or a stand-in when the embed came back empty.
 *
 * The fallback is passed in rather than hardcoded here, so it goes through `t()`
 * like every other string on this page.
 */
function assetLabel(row: Handover, unknown: string): string {
  if (!row.asset) return unknown;
  return `${row.asset.assetCode} — ${row.asset.name}`;
}

/**
 * The holder's name, with the position when there is one.
 *
 * `name` is `not null` in the database, so the only way this returns the unknown
 * fallback is a handover whose roster row has since gone — and even then it says
 * "Unknown" rather than a bare uuid, which is what the old
 * `fullName || email || id` chain degraded to for an unnamed profile.
 *
 * The position is appended because the roster is deliberately not unique on name:
 * two people can genuinely be called "Budi", and the picker already disambiguates
 * them, so the list that comes back from that picker must not lose it.
 */
function personLabel(person: Handover["holder"], unknown: string): string {
  if (!person || !person.name) return unknown;
  return person.position ? `${person.name} — ${person.position}` : person.name;
}

/**
 * The issuer's name, with the email as the fallback.
 *
 * `issuedBy` is `null` once the issuing account has been deleted —
 * `assignments.assigned_by` is `on delete set null` — so the unknown fallback is a
 * real state rather than a defensive branch.
 */
function issuerLabel(person: Handover["issuedBy"], unknown: string): string {
  if (!person) return unknown;
  return person.fullName || person.email || unknown;
}

/**
 * A `date` column is stored as `YYYY-MM-DD` with no time and no zone.
 *
 * Formatting it through `new Date(...)` and a locale formatter is how a date
 * silently moves a day backwards for anyone west of UTC: the string parses as
 * UTC midnight and is then read in local time. The three parts are already there,
 * so they are put back together directly instead.
 */
function formatDateOnly(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const label = months[Number(month) - 1] ?? month;
  return `${day} ${label} ${year}`;
}

/** A `timestamptz` really is an instant, so this one can go through `Date`. */
function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * One **batch**'s actions, behind a single menu.
 *
 * The menu is **Print, Detail, and Delete — nothing else.** Return used to be here as
 * one item per open asset, and that is what pushed it out: a batch of ten devices
 * produced ten menu entries, each repeating a device name, so the dropdown grew down
 * past the bottom of the viewport and became a list to scroll rather than a menu.
 * The names were also the same names the Detail modal shows, so the menu was saying
 * nothing the asset list did not.
 *
 * **Return now lives in the Detail modal, one button beside each device.** That is
 * where the device already is: a control acting on an asset is next to the asset, and
 * the modal is the one place the whole batch is listed at once. It also means the
 * dropdown stays a dropdown — three items, all of which act on the batch as a whole.
 *
 * **Per-asset stays per-asset.** Return is still one `handoverId` per press, so the
 * partial return that motivates batching is still expressible: return the laptop,
 * leave the mouse. Only the *location* of the control moved, not its granularity.
 *
 * **A menu rather than inline buttons**, matching `UserListPage`'s row menu: one
 * `HorizontaLDots` trigger for a column that would otherwise carry one button per
 * asset in the batch.
 *
 * **Which items appear is a UI convenience, never the enforcement point.**
 * `assignments_delete_admin` refuses whatever the gate lets through, and Return's own
 * gate lives in the Detail modal for the same reason. What the gates buy is not
 * showing a control that cannot work.
 *
 * Only one menu is open at a time, and the page owns which one: `openMenuId` lives
 * here as a prop rather than a `useState` per row, because a boolean per row would
 * mean a component per row just to hold it. It is keyed on the **batch's seed id**,
 * which is stable for the batch exactly as long as the row it came from exists.
 */
function HandoverBatchActions({
  batch,
  canDelete,
  isSaving,
  openMenuId,
  setOpenMenuId,
  onDelete,
  onPrint,
  onDetail,
}: {
  batch: HandoverBatch;
  canDelete: boolean;
  isSaving: boolean;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  onDelete: (row: Handover) => void;
  onPrint: () => void;
  onDetail: () => void;
}) {
  const { t } = useTranslation("common", { keyPrefix: "handover" });
  const isMenuOpen = openMenuId === batch.seed.id;

  /** Delete is only ever offered on devices already back. */
  const showDelete =
    canDelete && batch.items.some((row) => row.returnedAt !== null);

  /**
   * Wraps a handler so the menu closes first.
   *
   * Closing before the work rather than after matters for Delete, which opens a
   * modal: the modal renders over the page, and a menu still open behind it is the
   * layer that ends up focused when it closes.
   */
  const run = (action: () => void) => () => {
    setOpenMenuId(null);
    action();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpenMenuId(isMenuOpen ? null : batch.seed.id)}
        aria-label={t("actionsLabel", {
          name: t("actionsBatchName", { count: batch.items.length }),
        })}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        className="dropdown-toggle rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
        disabled={isSaving}
      >
        <HorizontaLDots className="size-5" />
      </button>

      {isMenuOpen && (
        <Dropdown isOpen onClose={() => setOpenMenuId(null)}>
          <DropdownItem onClick={run(onPrint)}>{t("print")}</DropdownItem>

          {/* Detail second, right after Print: both are read-only and both work on
              the whole batch, and the asset list is what an admin opens when they are
              not sure what went out. It is offered here as well as from the cell, so
              the list is reachable whether the eye is on the assets or on the menu. */}
          <DropdownItem onClick={run(onDetail)}>
            {t("detailAssets", { count: batch.items.length })}
          </DropdownItem>

          {/* Delete only on assets already back. The title explains the reasoning
              rather than leaving the item silently absent — the real reason an open
              handover cannot be deleted is that deleting it would put the asset back
              in stock while the person still has it. */}
          {/* Delete, one item per device already back. It stays here rather than
              moving into Detail with Return, because it is an **admin-only, rare,
              destructive** action: putting it beside every device in the asset list
              would put a delete button on eight rows to be clicked once. */}
          {showDelete &&
            batch.items
              .filter((row) => row.returnedAt !== null)
              .map((row) => (
                <DropdownItem
                  key={`delete-${row.id}`}
                  onClick={run(() => onDelete(row))}
                  className="text-error-600 hover:bg-error-50 dark:text-error-500 dark:hover:bg-error-500/10"
                >
                  {t("deleteAsset", {
                    name: assetLabel(row, t("fields.unknown")),
                  })}
                </DropdownItem>
              ))}
        </Dropdown>
      )}
    </div>
  );
}
