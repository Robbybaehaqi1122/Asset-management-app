import type { Department } from "@/modules/departments/services/departmentService";
import {
  createDepartment,
  deleteDepartment,
  DepartmentInUseError,
  getDepartments,
} from "@/modules/departments/services/departmentService";
import type { Company } from "@/modules/companies/services/companyService";
import {
  CompanyInUseError,
  createCompany,
  deleteCompany,
  getCompanies,
  updateCompany,
} from "@/modules/companies/services/companyService";
import type { Position } from "@/modules/positions/services/positionService";
import {
  createPosition,
  deletePosition,
  getPositions,
  PositionInUseError,
  updatePosition,
} from "@/modules/positions/services/positionService";

/**
 * The three organisation lists, described so one panel can render all of them.
 *
 * ## Why this file exists
 *
 * `DepartmentListPage`, `PositionListPage` and `CompanyListPage` were 434, 476 and 473
 * lines of the same screen — same load, same two modals, same table, same
 * `isDuplicateError`, and two of the three already disagreed about whether the frame was
 * called `Frame` or nothing. Consolidating them into tabs without addressing that would
 * have copied ~1,140 lines into the new screen and frozen the drift in place, so the
 * difference between them is reduced to **data** here and one panel does the rest.
 *
 * ## What is *not* abstracted
 *
 * The service calls themselves. Each list keeps its own module, its own error classes
 * and its own column list, because those are the things the database actually differs
 * on — `DepartmentInUseError` says "members" where `PositionInUseError` says "holders",
 * and that wording is a fact about the foreign key rather than a rendering choice.
 *
 * ## Departments cannot be renamed, and that is deliberate
 *
 * `update` is absent for departments, and the panel renders no edit control at all rather
 * than a disabled one. The reason is not the UI: `categories.department` is **free text**,
 * not a foreign key to `departments`, so renaming a department would not move the
 * categories that name it — and a category's department is what `assets_sync_department`
 * copies onto every asset, which would silently shift assets between the IT and HSSE
 * unit filters. `profiles.department_id` is a real FK and would follow the rename
 * correctly; it is the categories side that cannot.
 */
export type ReferenceRow = {
  id: string;
  name: string;
  description: string | null;
  /**
   * How many things point at this row.
   *
   * **Carried on the row rather than read back through a callback, and that is a fix
   * rather than a style.** The first version normalised each list to `{id, name,
   * description}` and asked `spec.usageCount(row)` for the number — which meant the
   * normaliser had already thrown the count away and the callback was reading
   * `undefined` off a row that no longer had the field. So the count rendered as an
   * empty `{count}`, and `disabled={usage > 0}` became `undefined > 0`, which is `false`:
   * **the delete button was enabled for a position somebody was still holding**, on a
   * foreign key that is `on delete restrict`. Silent, and it would only have shown up as
   * a database refusal at the moment somebody clicked it.
   *
   * A normalised row shape has to carry everything the panel reads. If the panel wants it,
   * `list()` must return it.
   */
  usage: number;
};

export type ReferenceInput = { name: string; description: string };

export type ReferenceListSpec = {
  /** i18n prefix of the owning module's strings. See `key()` below for why it is a string. */
  keyPrefix: "departments" | "positions" | "companies";
  /** `sidebar.items.<key>`, so a tab and its menu row can never read differently. */
  tabLabelKey: string;

  list: () => Promise<ReferenceRow[]>;
  create: (input: ReferenceInput) => Promise<void>;
  /** Absent where the list cannot be renamed. The panel hides edit rather than disabling it. */
  update?: (id: string, input: ReferenceInput) => Promise<void>;
  remove: (id: string) => Promise<void>;

  /** The count on an in-use refusal, or `null` when the error is something else. */
  inUseCount: (error: unknown) => number | null;

  /** `addDepartment` / `addPosition` / `addCompany` — the one string that cannot be derived. */
  addKey: string;
  /** `noMembers` / `noHolders` — what a zero count is called here. */
  usageZeroKey: string;
  /** `members` / `holders` — what a non-zero count is called here. */
  usageManyKey: string;
  /**
   * `errors.create` for departments, `errors.save` for the other two.
   *
   * Kept per-spec rather than unified because the three blocks were written at different
   * times and use different verbs for the same refusal. Adding a third spelling is
   * cheaper than editing strings a translator may already hold.
   */
  saveErrorKey: string;
};

/** Shared id/name/description copy. Each spec adds its own count on top. */
function base(row: {
  id: string;
  name: string;
  description: string | null;
}): Omit<ReferenceRow, "usage"> {
  return { id: row.id, name: row.name, description: row.description };
}

export const DEPARTMENT_LIST: ReferenceListSpec = {
  keyPrefix: "departments",
  tabLabelKey: "sidebar.items.department",
  list: () =>
    getDepartments().then((rows: Department[]) =>
      rows.map((row) => ({ ...base(row), usage: row.memberCount })),
    ),
  create: ({ name, description }) =>
    createDepartment({ name, description }).then(() => undefined),
  // No `update`. See the type's doc comment for why a department cannot be renamed.
  remove: (id) => deleteDepartment(id).then(() => undefined),
  inUseCount: (error) =>
    error instanceof DepartmentInUseError ? error.memberCount : null,
  addKey: "departments.addDepartment",
  usageZeroKey: "departments.noMembers",
  usageManyKey: "departments.members",
  saveErrorKey: "departments.errors.create",
};

export const POSITION_LIST: ReferenceListSpec = {
  keyPrefix: "positions",
  tabLabelKey: "sidebar.items.position",
  list: () =>
    getPositions().then((rows: Position[]) =>
      rows.map((row) => ({ ...base(row), usage: row.holderCount })),
    ),
  create: ({ name, description }) =>
    createPosition({ name, description }).then(() => undefined),
  update: (id, { name, description }) =>
    updatePosition(id, { name, description }).then(() => undefined),
  remove: (id) => deletePosition(id).then(() => undefined),
  inUseCount: (error) =>
    error instanceof PositionInUseError ? error.holderCount : null,
  addKey: "positions.addPosition",
  usageZeroKey: "positions.noHolders",
  usageManyKey: "positions.holders",
  saveErrorKey: "positions.errors.save",
};

export const COMPANY_LIST: ReferenceListSpec = {
  keyPrefix: "companies",
  tabLabelKey: "sidebar.items.company",
  list: () =>
    getCompanies().then((rows: Company[]) =>
      rows.map((row) => ({ ...base(row), usage: row.memberCount })),
    ),
  create: ({ name, description }) =>
    createCompany({ name, description }).then(() => undefined),
  update: (id, { name, description }) =>
    updateCompany(id, { name, description }).then(() => undefined),
  remove: (id) => deleteCompany(id).then(() => undefined),
  inUseCount: (error) =>
    error instanceof CompanyInUseError ? error.memberCount : null,
  addKey: "companies.addCompany",
  usageZeroKey: "companies.noMembers",
  usageManyKey: "companies.members",
  saveErrorKey: "companies.errors.save",
};

/** Draw order: departments first, because everything else hangs off a department. */
export const ORGANISATION_LISTS: ReferenceListSpec[] = [
  DEPARTMENT_LIST,
  POSITION_LIST,
  COMPANY_LIST,
];
