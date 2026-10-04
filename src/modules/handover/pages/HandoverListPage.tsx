import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Label from "@/components/form/Label";
import Checkbox from "@/components/form/input/Checkbox";
import Input from "@/components/form/input/InputField";
import Select from "@/components/form/Select";
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
   */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return handovers.filter((row) => {
      if (statusFilter === "open" && row.returnedAt !== null) return false;
      if (statusFilter === "returned" && row.returnedAt === null) return false;
      if (needle === "") return true;
      return [
        assetLabel(row, t("fields.unknown")),
        personLabel(row.holder, t("fields.unknown")),
        row.asset?.handoverDocNo ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [handovers, search, statusFilter, t]);

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
                {visible.map((row) => {
                  const isOpen = row.returnedAt === null;
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-gray-100 dark:border-gray-800"
                    >
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                          {assetLabel(row, t("fields.unknown"))}
                        </p>
                        {row.asset?.handoverDocNo && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {t("table.doc")}: {row.asset.handoverDocNo}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {personLabel(row.holder, t("fields.unknown"))}
                        </p>
                        {/* The third fact about the holder. The position is
                            already in the line above; the department is what
                            remains, and the roster is not unique on name so all
                            three are needed to tell two people apart. */}
                        {row.holder?.departmentName && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {row.holder.departmentName}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {formatTimestamp(row.assignedAt)}
                        </p>
                        {/* Who pressed the button, which is a *different* person
                            from the holder whenever an admin issues a handover to
                            somebody else. `assigned_by` is an account and stays
                            one; only the recipient moved to the roster. */}
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t("table.recordedBy")}:{" "}
                          {issuerLabel(row.issuedBy, t("fields.unknown"))}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {formatDateOnly(row.dueDate)}
                      </td>
                      <td className="px-4 py-3">
                        {isOpen ? (
                          <Badge size="sm" color="warning">
                            {t("status.open")}
                          </Badge>
                        ) : (
                          <Badge size="sm" color="success">
                            {t("status.returned")}
                          </Badge>
                        )}
                        {row.conditionAtHandover && (
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {t(`condition.${row.conditionAtHandover}`)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <HandoverRowActions
                          row={row}
                          isOpen={isOpen}
                          canReturn={isAdmin || ownUserIds.has(row.userId)}
                          canDelete={isAdmin}
                          isSaving={isSaving}
                          openMenuId={openMenuId}
                          setOpenMenuId={setOpenMenuId}
                          onReturn={() => void handleReturn(row)}
                          onDelete={() => handleOpenDelete(row)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
 * One row's actions, behind a single menu.
 *
 * **A menu rather than two inline buttons**, matching `UserListPage`'s row menu,
 * and the reason there is a real gain rather than a style preference: the Action
 * column was the widest cell in the table while carrying two small controls, so
 * it was taking horizontal space to say nothing. One `HorizontaLDots` trigger
 * gives it back.
 *
 * **Which items appear is a UI convenience, never the enforcement point.**
 * `assignments_update_own_or_admin` and `assignments_delete_admin` refuse whatever
 * the gate lets through. What the gate buys is not showing an item that cannot
 * work — and for Return specifically the membership test is the **roster id**
 * against `ownUserIds`, never `row.userId === user?.id`, which went false for every
 * row once `user_id` moved onto `handover_users` in `02000`.
 *
 * Only one menu is open at a time, and the page owns which one: `openMenuId` lives
 * here as a prop rather than a `useState` per row, because a boolean per row would
 * mean a component per row just to hold it.
 */
function HandoverRowActions({
  row,
  isOpen,
  canReturn,
  canDelete,
  isSaving,
  openMenuId,
  setOpenMenuId,
  onReturn,
  onDelete,
}: {
  row: Handover;
  isOpen: boolean;
  /** Whether this caller may close this handover, per the policy above. */
  canReturn: boolean;
  canDelete: boolean;
  isSaving: boolean;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  onReturn: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("common", { keyPrefix: "handover" });
  const isMenuOpen = openMenuId === row.id;

  /**
   * What the menu would actually contain, computed **before** the early return.
   *
   * Testing the permissions instead of the rendered items is the trap here, and it
   * produces an empty menu in the most ordinary case on the screen: a staff member
   * looking at a handover that has already come back. They may return it
   * (`canReturn` is true) but there is nothing to close, so the Return item is not
   * rendered — and they cannot delete, so the menu ends up with no items at all
   * behind a kebab that opens.
   *
   * So the guard asks the question the menu actually answers: is there an item?
   */
  const showReturn = isOpen && canReturn;
  const showDelete = canDelete;

  /**
   * Nothing to act on, so no trigger at all rather than a disabled one. A staff
   * member looking at somebody else's handover has neither. A kebab that opens
   * onto an empty list is a control that looks actionable and is not.
   */
  if (!showReturn && !showDelete) return null;

  /**
   * Wraps a handler so the menu closes first.
   *
   * Closing before the work rather than after matters for the two actions that
   * open a modal: the modal renders over the page, and a menu still open behind
   * it is the layer that ends up focused when it closes.
   */
  const run = (action: () => void) => () => {
    setOpenMenuId(null);
    action();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpenMenuId(isMenuOpen ? null : row.id)}
        aria-label={t("actionsLabel", {
          name: assetLabel(row, t("fields.unknown")),
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
          {/* Return only while the handover is open. A closed one has nothing to
              close, and offering it would produce a `23514` from
              `assignments_guard_asset_available` for a nonsensical edit. */}
          {showReturn && (
            <DropdownItem
              onClick={run(onReturn)}
              className={isSaving ? "pointer-events-none opacity-50" : ""}
            >
              {t("return")}
            </DropdownItem>
          )}

          {showDelete && (
            /* The title sits on a wrapper, not on the item: a disabled control
               does not receive pointer events, so a tooltip on it would never
               show — and the wording is the point, because the real reason an open
               handover cannot be deleted is that deleting it would put the asset
               back in stock while the person still has it. */
            <span title={isOpen ? t("deleteOpenHint") : undefined}>
              <DropdownItem
                onClick={run(onDelete)}
                className={
                  isOpen
                    ? "pointer-events-none opacity-50"
                    : "text-error-600 hover:bg-error-50 dark:text-error-500 dark:hover:bg-error-500/10"
                }
              >
                {t("delete")}
              </DropdownItem>
            </span>
          )}
        </Dropdown>
      )}
    </div>
  );
}
