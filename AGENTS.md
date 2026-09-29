# AGENTS.md — Asset Management App

> Guidance for AI agents and contributors. Every claim below describes the
> repository **as it actually is**. If you find something here that no longer
> matches the code, fix this file in the same change.

## Current state

The application shell is complete and working — sidebar, header, theming, i18n,
auth pages, calendar — wrapped around a blank dashboard. **Supabase auth is now
wired up**: email/password sign in, sign up, password reset, session persistence,
and route protection all go through a real backend.

The asset management domain is **partly implemented** as of issue #49, with the
form made **dynamic per category** by issue #50. `src/modules/assets/` is the
asset inventory: a readable-by-everyone list with search and filters, badges, an
admin-only add/edit form, a status control and a guarded delete. The form's five
tabs no longer show the same fields for every asset — they switch on the **main**
category, so a switch is a server-rendered bitmap, a display offers its input
ports and a network device offers its port counts. Credentials live in their own
table and are readable by admins only. **Assignments and maintenance are still
not implemented** — there is no code in `src/` that creates a loan or schedules a
repair, so the two tables the inventory depends on are written by nothing but the
test fixtures. See The asset inventory, The form switches on a category code, and
Database.

**All fifteen migrations, including `20260927001500`, are applied to the remote**
as of 2026-09-29. `db diff --linked` reports `No schema changes found`, and
`pg_indexes` returns 27 for `public` on both the local and the remote database.
The 14 `drop column` statements that `db diff --linked` listed while `01100` was
unpushed were the diff saying the remote was behind the files — not drift, and
not something to fix by hand. The next migration will produce the same list again
until it is pushed, and the way to tell the two apart is
`supabase_migrations.schema_migrations`, not the CLI's wording. See Database.

The "Sign in with Google" and "Sign in with X" buttons, the "or" divider that
separated them from the form, and the "back to dashboard" link are all gone
from `SignInForm`. They were `disabled` placeholders, and the divider existed
only to separate two ways to sign in — with no second way, "or" had nothing on
the other side of it.

## Stack

- **React 19**, strict **TypeScript 5.9**, bundled by **Vite 8** with rolldown.
- **react-router 8** — the package is `react-router`, *not* `react-router-dom`.
- **Tailwind CSS v4**, configured entirely through `src/index.css`. There is no
  `tailwind.config.js`, and you must not add one.
- **@supabase/supabase-js 2.117** — email/password auth only. One client
  instance in `src/lib/supabase.ts`; import it from there, never call
  `createClient` again.
- **@fullcalendar/react** for the calendar, **flatpickr** for date inputs.
- **i18next + react-i18next**, a single `"common"` namespace, **English only**.
- **react-helmet-async** via `<PageMeta>` for per-page `<title>`.
- **SVGR** turns `src/icons/*.svg` into React components at build time.
- Path alias `@/*` → `src/*`, set in both `tsconfig.app.json` and `vite.config.ts`.
- **Node `^20.19.0 || >=22.12.0`**, declared in `engines`. Vite 8 and
  `@vitejs/plugin-react` both require it, and the failure on older Node is a
  cryptic bundler crash rather than a clear version error, so the field is
  there to make `npm` say so up front instead.
- **No CI.** `npm run build` and `npm run lint` are the only automated gates.

## Commands

```bash
npm run dev       # Vite dev server with HMR
npm run build     # tsc -b && vite build — the gate that matters, it type-checks
npm run lint      # eslint . — currently 0 errors, 5 warnings
npm run preview   # serve dist/
```

Formatting is **not** wired into `package.json` — Prettier is a devDependency and
that is all. Run it directly:

```bash
npx prettier --check "src/**/*.{ts,tsx,css}"   # clean as of the #23 fix
npx prettier --write  "src/**/*.{ts,tsx,css}"
```

That glob is the intended scope. A bare `npx prettier --check .` also walks
`dist/`, `supabase/.temp/`, and the markdown, none of which are kept formatted —
there is no `.prettierignore`. Use the glob.

**Line endings: `.gitattributes` owns them.** It sets `* text=auto eol=lf`, which
is what makes the check above meaningful. Without it, `core.autocrlf=true` on
Windows checks files out as CRLF while Prettier defaults to `endOfLine: "lf"`, and
*every* file fails — including ones just written by `prettier --write`. Do not
"fix" that with `--end-of-line crlf` or by setting `endOfLine: "auto"` in
`.prettierrc`; both trade a real bug for a workaround. If you ever see the whole
tree reported unformatted, check that `.gitattributes` is still there first.

`npm run lint` has 5 warnings, all `react-refresh/only-export-components`, from
files that export a hook next to a component. Four are pre-existing; the fifth is
`AuthContext.tsx`, added with the auth work. They are acceptable. **Adding a new
lint error is a regression**; adding a new warning of that same rule is not, but
say so in the PR.

`npm run build` must pass before you push. There is no CI to catch it for you.

### The empty-env build trap

`src/lib/supabase.ts` throws at module scope when `VITE_SUPABASE_URL` or
`VITE_SUPABASE_ANON_KEY` is empty. Vite replaces `import.meta.env.VITE_*` with a
string literal at build time, so with an empty `.env.local` rolldown folds
`if (!"" || !"")` into an unconditional throw, marks the `createClient` call
unreachable, and **tree-shakes the whole Supabase client out of the bundle**.

The result still builds, still passes `tsc`, and still passes `eslint`. The
bundle is 199 kB instead of 965 kB, and contains no auth code at all. The app is
unusable and nothing tells you.

So **a suspiciously small production bundle is the symptom, not the goal.** If
`dist/assets/*.js` drops to roughly 200 kB, the credentials were empty at build
time. In dev the Vite error overlay shows the real message; in production you get
a white screen. Check the credentials before trusting a build.

Real sizes, for reference: 965.65 kB / 273.94 kB gzipped with Supabase wired
in, against 199.17 kB / 63.26 kB gzipped before it. Adding Supabase roughly
quadruples shipped JavaScript, because `@supabase/supabase-js` bundles
realtime/websocket, PostgREST, and the storage client that this app does not use
yet. There is no official auth-only subpackage for v2; `@supabase/auth-js` would
be the only lever, and it is a transitive dependency, so switching would mean
adding it explicitly. Not done. Revisit if bundle size becomes a real problem.

Vite warns about chunks over 500 kB, and this one clears that bar by a wide
margin. **The warning is not the argument** — the owner accepted this cost
deliberately, and nothing here is broken. Do not open a bundle-size thread
because the warning is loud.

## The 13 retained primitives

These were kept on purpose during cleanup. **Twelve have no consumer anywhere in
the app.** That is expected. They are the component library, and reachability
tooling will report them as orphans. Do not delete them for that reason.

| Component | Import path | Export |
|---|---|---|
| `Alert` | `@/components/ui/alert/Alert` | default |
| `Avatar` | `@/components/ui/avatar/Avatar` | default |
| `Badge` | `@/components/ui/badge/Badge` | default |
| `ComponentCard` | `@/components/ui/ComponentCard` | default |
| `Table` | `@/components/ui/table` | **named** — `Table`, `TableBody`, `TableCell`, `TableHeader`, `TableRow` |
| `DatePicker` | `@/components/form/date-picker` | default |
| `FileInput` | `@/components/form/input/FileInput` | default |
| `MultiSelect` | `@/components/form/MultiSelect` | default |
| `PhoneInput` | `@/components/form/group-input/PhoneInput` | default |
| `Radio` | `@/components/form/input/Radio` | default |
| `Select` | `@/components/form/Select` | default |
| `Switch` | `@/components/form/switch/Switch` | default |
| `TextArea` | `@/components/form/input/TextArea` | default |

`Table` is the only one with named exports and no default export.

Also present and already wired into the shell: `Button`, `Dropdown`,
`DropdownItem`, `Modal` under `@/components/ui/`, and `Label`, `Checkbox`,
`InputField` under `@/components/form/`.

## Repo map

```
src/
├── App.tsx                    ALL routes live here — nested under two guards
├── main.tsx                   entry: providers, i18n bootstrap, global CSS
├── index.css                  @theme tokens (133), @utility classes, vendor overrides
├── lib/                       supabase.ts (the client), profiles.ts (the one
│                              profiles query), authErrors.ts (code -> i18n key),
│                              password.ts (CSPRNG temp-password generator)
├── pages/
│   ├── Dashboard/Dashboard    the blank "/" page
│   ├── AuthPages/             SignIn, ResetPassword, AuthPageLayout (shell, not a route)
│   ├── Profile/Profile        the "/profile" page — own `profiles` row, read-only
│   ├── Calendar.tsx
│   └── OtherPage/             NotFound, Blank
├── components/
│   ├── ui/                    alert/ avatar/ badge/ button/ dropdown/ modal/ table/
│   │                          ComponentCard
│   ├── form/                  date-picker, input/, select, MultiSelect, switch/,
│   │                          group-input/PhoneInput, Label
│   ├── common/                PageMeta PageBreadCrumb ScrollToTop
│   │                          ThemeToggleButton ThemeTogglerTwo GridShape
│   ├── header/                NotificationDropdown UserDropdown
│   ├── auth/                  SignInForm ResetPasswordForm
│   │                          RequireAuth PublicOnlyRoute AuthLoading
│   │                          MustChangePassword (the 00800 gate)
│   └── calendar/              the calendar feature: Calendar CalendarEventModal
│                              CalendarEventItem CalendarViewSelect icons types
│   └── modules/               self-contained features: users/, departments/, assets/
│       ├── users/             the user-management feature: pages/ services/
│       │                      see User management
│       ├── departments/       the department feature: list + create, feeds the pickers
│       ├── asset-settings/    the reference-data editor: pages/ services/
│       │                      see Asset settings manages the reference data
│       └── assets/            the asset inventory: pages/ services/
│                              see The asset inventory
├── layout/                    AppLayout AppSidebar AppHeader Backdrop
├── context/                   AuthContext ThemeContext SidebarContext LanguageContext
├── hooks/                     useModal useClickOutside useIsAdmin
├── i18n/                      index.ts bootstrap, languages.ts registry
├── locales/en/common.json     the only locale file
├── icons/                     31 .svg + index.ts barrel (SVGR named exports)
├── utils/index.ts             cn()
├── svg.d.ts                   ambient types for the SVGR `?react` import
└── vite-env.d.ts              ImportMetaEnv for the two VITE_SUPABASE_* keys

supabase/
├── config.toml                generated by `supabase init`, project_id + PG 17
├── .gitignore                 ignores .temp and .env.keys (NOT the root one)
├── .temp/                     per-clone CLI state — project-ref, linked-project.json
├── functions/create-user/      Admin API caller; see Creating an account
├── functions/delete-user/      the hard delete; see Delete, and why a hard delete
├── functions/reset-password/   admin-forced reset; see Resetting a password
└── migrations/                the schema, applied in filename order
    ├── 20260927000100_schema.sql     6 tables, 10 explicit indexes
    ├── 20260927000200_triggers.sql   6 functions, 8 triggers
    └── 20260927000300_rls.sql        grants, RLS, 14 policies
    └── 20260927000400_drop_first_admin_grant.sql  handle_new_user always 'staff'
    └── 20260927000500_sync_asset_status_with_assignments.sql  status/loan sync
    └── 20260927000600_profiles_email.sql  profiles.email + backfill
    └── 20260927000700_user_management_guards.sql  last-admin + email guards
    └── 20260927000800_must_change_password.sql  one column, no trigger
    └── 20260927000900_departments.sql  the departments table + backfill
    └── 20260927001000_asset_inventory.sql  21 columns on assets + credentials
    └── 20260927001100_asset_dynamic_form.sql  categories.code + seed + 13 columns
    └── 20260927001200_asset_excel_headers.sql  the workbook's headings + port counts
    └── 20260927001300_asset_settings.sql  locations area+room, category guards
    └── 20260927001400_asset_category_department.sql  categories.department
    └── 20260927001500_asset_hsse_fields.sql  HSSE expiry/inspection/calibration

.github/
├── ISSUES_KNOWN.md            known problems, grouped by severity
└── ISSUE_TEMPLATE/            known-issue.yml

vercel.json                    SPA rewrite only — no framework, no buildCommand
```

## Database

`supabase/migrations/` holds the schema, applied to project
`dnyszknpinqvcfkmoauz` (Postgres 17.6.1). Fifteen migrations, in order:

| File | Contents |
|---|---|
| `20260927000100_schema.sql` | 6 tables, 10 explicit indexes, column comments |
| `20260927000200_triggers.sql` | `set_updated_at`, `handle_new_user`, 2 maintenance guards, `is_admin`, `protect_profile_role` |
| `20260927000300_rls.sql` | grants, `enable`/`force row level security` on all 6 tables, 14 policies |
| `20260927000400_drop_first_admin_grant.sql` | `handle_new_user` redefined to always insert `staff`; see Promoting the first admin |
| `20260927000500_sync_asset_status_with_assignments.sql` | 2 triggers keeping `assets.status` honest; see Asset status follows the loans |
| `20260927000600_profiles_email.sql` | `profiles.email`, `handle_new_user` copies it, backfill, unique index |
| `20260927000700_user_management_guards.sql` | `guard_last_admin` and `protect_profile_email`; see User management |
| `20260927000800_must_change_password.sql` | `profiles.must_change_password boolean not null default false`; one column, no trigger; see The temporary password is a prompt, not a boundary |
| `20260927000900_departments.sql` | `departments` table, `profiles.department` text -> `department_id` uuid, backfill, rewritten `handle_new_user`; see Departments are reference data |
| `20260927001000_asset_inventory.sql` | 21 columns on `assets`, `categories.parent_id`, the `asset_credentials` table; see The asset inventory |
| `20260927001100_asset_dynamic_form.sql` | `categories.code`, 13 per-category columns on `assets`, the category and location seed; see The form switches on a category code |
| `20260927001200_asset_excel_headers.sql` | the workbook's own per-sheet headings, port counts replacing the two array columns, `usage_status`, the workbook's sub-categories; see The workbook is the specification |
| `20260927001300_asset_settings.sql` | `locations.name` -> `area_name` + `room_name` + `notes`, the category delete guard, the no-third-level guard; see Asset settings manages the reference data |
| `20260927001400_asset_category_department.sql` | `categories.department`, uniqueness per unit replacing the global one, the cross-unit and move-with-children guards; see Categories belong to a unit |
| `20260927001500_asset_hsse_fields.sql` | the four HSSE columns and the `assets.department` trigger that keeps the unit in step with the category; see The asset form switches on the unit |

**All fifteen are applied to the remote.** `db diff --linked` reports
`No schema changes found`, which is the proof that the checked-in migrations and
the live database agree. Before the `01100` push it reported fourteen `drop
column` statements; that was the diff saying the remote was behind the
checked-in files, the normal state between authoring a migration and pushing it,
not drift and not something to repair by hand.

Read the ledger rather than trusting the CLI's wording, because this file
previously claimed `00900` was still unpushed when it had already been applied.

Note that `db push` printed `Remote database is up to date.` immediately after
applying 004, with no "Applying migration" line. That message is not a reliable
signal in either direction — confirm a push landed by reading
`supabase_migrations.schema_migrations`, not by trusting the CLI's wording.

`pg_indexes` reports **27** for `public` on both the local and the remote
database. The 27 is 8 primary keys, 6 unique constraints (`assets.asset_code`,
`categories.name`, `locations.name`, `departments.name`, `profiles.email`,
`asset_credentials.asset_id`) and 13 explicitly created indexes. `01100` added
the twenty-seventh, `categories_code_key`, and the remote was one short until it
was pushed. Postgres creates the index for a primary key or a unique constraint
itself, which is why none of the 14 are in the migration files.

There are now **8 tables** in `public`, not 6: `01000` added `asset_credentials`.
Two earlier claims that this file made about "6 tables" were true when written and
are listed in the table rows above for `001` and `003` — those describe what those
two files did, not the current schema.

### The CLI is not a dependency

`@supabase/supabase-js` is a runtime dependency. The **CLI is not** — there is no
`supabase` in `devDependencies`, so every command is `npx supabase`. That means
no `supabase` binary on your PATH and nothing pinned to a version.

### Run these from the project root

Every command below must run in the directory that **contains** `supabase/`,
which is the repo root. From a parent directory the CLI does not search
downward, finds no `supabase/` folder, and behaves as though nothing is set up.

```bash
npx supabase init     # once per clone — creates supabase/config.toml
npx supabase link     # once per clone — see below
npx supabase db push  # apply migrations to the linked project
```

`npx supabase link --project-ref dnyszknpinqvcfkmoauz` authenticates through the
Management API using the access token from `supabase login`, and prints only
`Finished supabase link.` — **it does not prompt for a database password.** It
writes `supabase/.temp/project-ref`, which is **gitignored** (by
`supabase/.gitignore`, not the root one) and therefore **absent after a fresh
clone**. Every clone needs its own `link`.

### `link` is not `login`, and this is the trap

| Command | Scope | Where state lands |
|---|---|---|
| `supabase login` | **global**, once per machine | the OS keychain |
| `supabase link` | **per directory**, once per clone | `supabase/.temp/project-ref` |

Logging in successfully does nothing for `db push`. Skipping `link` gives:

```
Cannot find project ref. Have you run supabase link?
```

That message names the missing command but not the two things that actually
matter: that `link` was never run (as opposed to having failed), and that it
must run from the repo root. Both bit during setup. If you see it, run `link`
from the repo root.

Confirm the link took before pushing:

```bash
cat supabase/.temp/project-ref
```

### Verify before pushing

Run in this order. `db reset --local` and `db diff --linked` are the two that
actually catch problems; the others are confirmation.

```bash
npx supabase db reset --local         # 1. does the migration even apply?
npx supabase db diff --linked         # 2. does the remote match the files?
npx supabase db lint --linked         # 3. schema check via Management API
npx supabase db push --dry-run        # 4. confirms there is something to push
npx supabase migration list --linked  # local vs remote versions
```

Step 4 is the weakest one and reads like a gate but is not: once every version is
recorded it prints `Remote database is up to date.` and exits 0 whether or not
the schemas agree. Never treat it as evidence. See Migrations are apply-once.

### Local tooling works

Docker Desktop 4.92.0 is installed, WSL2 backend, engine on `desktop-linux`. Every
local command works:

```bash
npx supabase start                     # boots the local stack, ~1 min cold
npx supabase db lint --local           # plpgsql_check, no Management API
npx supabase db reset --local          # drop + re-apply all migrations
npx supabase db diff --linked          # shadow DB, local files vs remote
npx supabase db dump --linked --schema public
npx supabase db query --local -f x.sql
```

`start` must be running first; every `--local` command then talks to
`127.0.0.1:54322`. If it reports `ECONNREFUSED 54322`, the stack is down, not
misconfigured.

**`db diff --linked` is the important one.** It applies the local migration files
to a throwaway shadow database, then diffs that against the real one. It reports
`No schema changes found`, which is the proof that the checked-in migrations and
the live remote database actually agree. Without it, a change made in the Supabase
Studio UI would be invisible to git.

**`db reset --local` is the pre-push gate.** It is how you find out a migration is
broken *before* it reaches the remote, where a mid-flight failure leaves the
database half-applied and cannot be undone without hand-written repair SQL. A
deliberately broken migration was confirmed to fail here with exit 1 while the
remote stayed untouched.

A missing `supabase/seed.sql` warning from `db reset` is expected — there is no
seed data, and the migrations create the schema themselves.

### Migrations are apply-once

They contain bare `create table` / `create policy` / `create trigger` with no
`if not exists`. That is correct and idiomatic: a migration is a historical
record, not an idempotent script. The three behaviours below were each verified
against the linked project, and the first one is not what you would expect.

**`db push` does not refuse — it silently skips.** With all three versions
already recorded, `db push --dry-run --linked` prints `Remote database is up to
date.` and exits 0. There is no error and no warning. This matters: if the remote
schema has drifted away from these files, `db push` will report success while
doing nothing to fix it. `db diff --linked` is what actually detects drift, and
you have to remember to run it.

**Hand-running the files fails on the first statement.** A second
`create table public.profiles` returns `error: relation "profiles" already
exists`. So the files are not a repair tool.

**`schema_migrations` is the ledger.** `supabase_migrations.schema_migrations`
holds one row per applied version — `20260927000100` schema, `20260927000200`
triggers, `20260927000300` rls, `20260927000400` drop first-admin grant,
`20260927000500` status/loan sync, `20260927000600` profiles.email,
`20260927000700` user-management guards, `20260927000800` must_change_password,
`20260927000900` departments, `20260927001000` asset_inventory,
`20260927001100` asset_dynamic_form, `20260927001200` asset_excel_headers,
`20260927001300` asset_settings, `20260927001400` asset_category_department,
`20260927001500` asset_hsse_fields. Read out of the linked project on
2026-09-29, which is all fifteen and therefore nothing pending. That table, not
the schema itself, is what the CLI consults to decide what is pending, and it is
also the only trustworthy way to confirm a push landed.

`migration list --linked` is the exception that proves the rule: it failed once
with `password authentication failed for user "cli_login_postgres"` while
`db query --linked` and `db diff --linked`, which authenticate differently, both
succeeded against the same project. A failure from that one command is not
evidence about the database.

`db reset --local` is the way to re-apply them from scratch, and it is safe
because the local database is disposable. **There is no equivalent for the
remote**, and that asymmetry is the whole reason to gate on `db reset --local`
before pushing. A migration that fails halfway on the remote leaves it
half-applied, and the only repair is hand-written SQL — no rollback, because
already-applied files are recorded as done in the ledger regardless.

All three are already applied to the remote project. **Do not edit them, and do
not add `if not exists` to make them re-runnable** — that would make the local
files diverge from what actually ran. Changes go in a new migration.

### Repairing a lost trigger

`handle_new_user` hangs off `auth.users`, a table Supabase owns and can recreate
on its own schedule. If that trigger is ever lost, **the fix is a new migration
that re-creates it — not an edit to `002`, and not a manual `create trigger`.**
Editing `002` changes a file whose version is already in the ledger, so the new
content would never run anywhere, and local files would stop describing the
remote.

The failure is silent by construction: with the trigger gone, signup still
succeeds, a row appears in `auth.users`, and no profile is ever created. Nothing
errors. That makes detection the only real defence.

`db diff --linked` **does** cover the `auth` schema, in both directions, which was
verified rather than assumed:

- a trigger present on the remote but not in the migrations → diff emits
  `DROP TRIGGER "…" ON "auth"."users";`
- a trigger in the migrations but missing from the database → diff emits the
  matching `CREATE TRIGGER`

So a plain `db diff --linked` returning `No schema changes found` is a real
guarantee that `on_auth_user_created` is attached, not just that the `public`
schema matches. The same query is the direct check:

```sql
select t.tgname, n.nspname || '.' || c.relname as on_table
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'auth' and c.relname = 'users';
```

The trigger also does not come back on its own: `db push` has nothing pending to
apply, so it will report the database as up to date while signup quietly stops
creating profiles.

## Environment

Two variables, both from Supabase Dashboard → Project Settings → API:

| Variable | Source |
|---|---|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | the publishable key, the one starting `sb_publishable_` |

This project uses a modern **publishable** key (`sb_publishable_…`), not the
legacy `anon` JWT (`eyJhbGci…`). Both are safe in the browser and both go in the
same variable; Supabase accepts either. If you copy a fresh key from the
dashboard it will be the `sb_publishable_` form.

The variable is still **named** `..._ANON_KEY` even though the value is a
publishable key. That is deliberate — renaming it would touch every call site
and `src/vite-env.d.ts` for no functional gain.

They go in **`.env.local`**, which `.gitignore` already covers via `*.local` and
which now also has explicit `.env` / `.env.*` rules with `!.env.example`. The
committed `.env.example` documents the shape without leaking anything.

The publishable key is designed to be in the browser and is safe to ship.
The **`service_role` key must never appear in this repo** — it bypasses RLS.
`.env` patterns are ignored, so a `service_role` in `.env.local` is also safe,
but putting one in `.env.example` or any committed file is a credential leak.
Note that a `service_role` would not help with schema anyway: PostgREST cannot
run DDL, so applying migrations needs the CLI, not a key. See Database.

`ImportMetaEnv` is declared by hand in `src/vite-env.d.ts` rather than left to
`vite/client`'s `[key: string]: any` index signature, so a misspelled variable
name is a type error instead of `undefined` at runtime.

## Routing

- Every route is registered in `src/App.tsx`. Add new pages there, nowhere else.
- Three groups, nested in this order:
  1. `<RequireAuth>` wraps `<AppLayout>` — sidebar + header for signed-in users.
  2. `<PublicOnlyRoute>` wraps `/signin` only — redirects a signed-in user to `/`.
     `/signup` no longer exists; see There is no signup route.
  3. `/reset-password` is a bare route, deliberately **outside both guards**.
     Supabase's recovery link creates a session on arrival, so `PublicOnlyRoute`
     would bounce the user straight back to `/` and the reset could never
     complete.
- `path="*"` is the 404 fallback.
- New page → create `src/pages/<Category>/MyPage.tsx` with a default export, then
  add its `<Route>` inside the right group. A **feature** that brings its own
  page plus service layer goes in `src/modules/<feature>/` instead — that is
  what `src/modules/users/` is. The route is still registered in `App.tsx`; the
  module directory only owns the files below it.
- `/profile` is inside the `RequireAuth` group, not beside it. It reads the
  signed-in user's own row, so there is nothing for an anonymous visitor to see
  and `PublicOnlyRoute` would only bounce a signed-in user away from it.
- `/users` is inside `RequireAuth` and has **no route-level admin guard**. The
  page checks `useIsAdmin()` and renders a refusal; RLS already limits the rows
  either way. A second guard would be a second place to keep in sync without
  adding a single row of enforcement.

### Deep links 404 without the SPA rewrite

Every route in `App.tsx` is client-side. Vercel serves static files, and it has
no file to serve for `/signin`, so a hard request for any path except `/`
returns its own 404 — **not** the app's. The app looks fine when you arrive at
`/` and then let the router navigate, which is exactly why this survives casual
testing and only shows up on refresh, on a bookmark, on a shared link, or on
sending someone a link to `/profile`.

`vercel.json` fixes it with a catch-all rewrite to `index.html`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

This is safe for assets **because Vercel checks the filesystem before it
applies rewrites**. `/assets/index-*.js` and `/images/**` exist on disk, so
they are served directly and never reach the rewrite. Verified: every
`src`/`href` in the built `dist/index.html` resolves to a real file.

Adding a route does not need a matching entry here. The rewrite is
deliberately `/(.*)`, so a new page works on a hard load as soon as it is
registered in `App.tsx`.

Do not add a `framework`, `buildCommand` or `outputDirectory` to this file
without being asked. Those are detected on Vercel today, and naming them here
would let the two drift apart silently.

## There is no signup route

`/signup` was removed, along with `SignUp.tsx`, `SignUpForm.tsx`, the
`signUp` method on `AuthContext`, and the 27 i18n keys that only that form
used. Users are created by an admin instead. A later change removed the social
sign-in buttons from `SignInForm` and took `auth.backToDashboard`, `auth.or`,
`auth.oauthNotReady`, `auth.signIn.withGoogle` and `auth.signIn.withX` with them,
so `auth` is now just `signIn`, `resetPassword` and `errors`.

**Removing the form does not close signup.** The GoTrue endpoint at
`/auth/v1/signup` is still open, so anyone can still create a `staff` account
with a direct request even though the UI is gone. The control that actually
enforces invite-only is the dashboard setting, **Authentication → Sign In /
Providers → Email → "Allow new users to sign up"**, off. That is a dashboard
action, not a repo change, so nothing in this repo shows whether it is on.

With the grant in `20260927000400` removed, an open endpoint is not a
privilege-escalation hole — every new account is `staff`, and the role column
is protected by `profiles_protect_role`. It means an unbounded supply of
`staff` rows, not admin.

Creating a user from the dashboard is the supported path today, and it needs
no `service_role` in this repo. `on_auth_user_created` fires on `auth.users`
INSERT regardless of how the row got there, so a dashboard-created user still
gets a `profiles` row automatically. That is what makes invite-only work with
no create-user code at all. A create-user button inside the app would need the
Admin API, which means a `service_role` key in the browser — see Don'ts.

## Supabase

- **One client.** `src/lib/supabase.ts` exports `supabase`; it is created at
  module scope. Import it. Do not call `createClient` anywhere else.
- `flowType: "implicit"` and `detectSessionInUrl: true` are left at Supabase's
  defaults on purpose. That combination is what lets the recovery link work with
  `BrowserRouter` — the token arrives in the URL hash, which the router ignores.
- Types come out as `AuthSession` / `AuthUser`, **not** `Session` / `User`.
  `supabase-js` re-exports them under those names. `SupportedStorage` is *not*
  re-exported, which is why `authStorage` in `supabase.ts` has no type
  annotation — annotating it would mean importing from `@supabase/auth-js`, a
  transitive dependency.

### The profile row, and how the client learns the role

`AuthContext` fetches one row from `public.profiles` alongside the session and
exposes it as `profile`. `src/lib/profiles.ts` holds the query and the hand-written
`Profile` type; there is no generated `Database` type, so `role` is a plain
`"admin" | "staff"` asserted by the database's check constraint, not by the type.

The fetch is keyed on `session.user.id` and needs no client-side filtering:
`profiles_select_own_or_admin` already means a non-admin can read only their own
row. Verified against the local stack — a staff token asking for someone else's id
gets `null`, **not** an error, because RLS filters rows instead of rejecting the
statement. So a wrong id fails closed rather than leaking.

Read the role with **`useIsAdmin()`**, never by comparing `profile?.role` inline:

- It fails **closed**. Between the session resolving and the row arriving,
  `profile` is `null` and the hook returns `false`, so admin-only write actions
  are never rendered. A button that does not appear beats one that appears and is
  then rejected by RLS on click.
- A screen that must distinguish "loading" from "not an admin" reads
  `isProfileLoading` from `useAuth` as well. That flag goes `false` once the fetch
  settles **either way**, including when there is genuinely no row — deriving it
  from `profile` instead would spin forever for a user whose row is missing.
- Hiding a control is a UI convenience, never a security control. RLS is still
  the only thing enforcing access.

`user_metadata` is not a substitute for any of this. It is whatever the client
sent at signup, so `UserDropdown` reads `profile.full_name` and only falls back to
`user.email`, which is the auth identity rather than free-form metadata.

`profile` is derived, not stored per-user. The state holds the row *and* the
`userId` it was fetched for, and the exposed value only matches when those agree.
That is what keeps a previous user's row from flashing on screen after a sign-out
or an account switch, and it avoids a `setState` in the effect body. A `cancelled`
flag in the effect cleanup covers the in-flight request.

### Hybrid storage and "Keep me logged in"

`auth.storage` is a hand-written adapter that routes to `localStorage` or
`sessionStorage` based on the `sb-persist-session` flag. Supabase has no
per-request `persistSession`, so this is the only way to make the checkbox
honest.

- Default, flag absent: `localStorage`. Supabase's normal behaviour.
- `setSessionPersistence(false)` is called **before** `signInWithPassword`, so the
  session lands in `sessionStorage` and dies with the tab.
- `clearAuthKeys` must keep excluding `PERSIST_KEY` explicitly. The flag's own
  name starts with `sb-`, the same prefix used to find Supabase's own keys, so
  without the exclusion it deletes the flag it just wrote, the mode silently
  reverts to persistent, and the checkbox becomes a no-op. This was a real bug
  during the initial implementation.

### Reset page mode selection

`ResetPasswordForm` picks its mode from **whether a session exists**, not from
the `PASSWORD_RECOVERY` event. Refreshing the page after following a recovery
link strips the URL hash, Supabase recovers the session from storage instead, and
the event never fires again — an event-driven check would strand the user on the
"request a link" form with no way forward.

### `redirectTo` is silently ignored when the exact URL is not allow-listed

`AuthContext.requestPasswordReset` sends
`redirectTo: \`${window.location.origin}/reset-password\``. GoTrue honours that
only if the URL is allow-listed — Authentication → URL Configuration on the
hosted project, `site_url` / `additional_redirect_urls` in
`supabase/config.toml` locally. When it is not, GoTrue **silently substitutes
`site_url`** and still reports success.

Measured against the local stack, with `redirect_to` read back out of the
delivered email rather than inferred from the API response:

| `redirectTo` asked for | link that arrives | `error` |
|---|---|---|
| `http://127.0.0.1:3000/reset-password` | as asked | `null` |
| `http://127.0.0.1:3000/a/b/c?q=1` | as asked | `null` |
| `http://localhost:5173/reset-password` | as asked, once listed | `null` |
| `http://localhost:5173/reset-password/x` | `http://127.0.0.1:3000` | `null` |
| `https://localhost:5173/reset-password` | `http://127.0.0.1:3000` | `null` |
| `http://127.0.0.1:3000.palsu.example` | `http://127.0.0.1:3000` | `null` |

**Every rejected case returns `null`.** A reset request that is about to be
delivered to the wrong place looks exactly like one that succeeded, so
`ResetPasswordForm` cannot tell the difference and the user only finds out after
waiting for an email that arrives at a page which is not this app. The API
response is not evidence either way — read the link out of the email.

The matching rule is **asymmetric**, which is the part that costs an hour:

- **`site_url` matches as a prefix.** Any path beneath it is honoured, including
  deep paths and query strings. `http://127.0.0.1:3000/a/b/c?q=1` works without
  ever being listed.
- **Entries in `additional_redirect_urls` must match exactly**, path included. A
  bare origin is not enough: with only `http://localhost:5173` listed,
  `http://localhost:5173/reset-password` is still rejected. List the whole URL,
  because the path comes from `window.location.pathname` and you cannot leave it
  out.
- **It is a parsed comparison, not string prefix matching.**
  `http://127.0.0.1:3000.palsu.example` is rejected, so a host that merely starts
  with the `site_url` host cannot smuggle a redirect out. **Scheme counts**:
  `https://localhost:5173/...` is rejected even with the `http` form listed.
- `localhost` and `127.0.0.1` are different origins at the same port, and Vite
  may serve either, so local entries list both.

`supabase/config.toml` now lists the two dev URLs in full. Before that,
`npm run dev` on `http://localhost:5173` had a **silently broken** password
reset: the form submitted, the API returned `error: null`, the email went out,
and the link landed on `127.0.0.1:3000` — a port nothing was listening on.

**The hosted project needs the same treatment and it is not a repo change.**
Authentication → URL Configuration → Redirect URLs on
`dnyszknpinqvcfkmoauz` carries these three, and the first two were confirmed
working end to end against production on 2026-09-27:

| `redirectTo` sent | origin in the delivered link |
|---|---|
| `https://pgt-asset.vercel.app/reset-password` | as asked — no fallback |
| `http://127.0.0.1:3000/reset-password` | as asked — `site_url` prefix match |
| `http://localhost:5173/reset-password` | **unconfirmed** — see below |

`pgt-asset.vercel.app` is the deployed app. It is **not** described anywhere in
this repo beyond this line — the connection to the project lives in the hosting
provider's settings, so nothing here will tell you it exists.

`vercel.json` is checked in, but it holds **only** the SPA rewrite. It does not
name the project, the framework or the output directory; those are still
detected or configured on Vercel. See Deep links 404 without the SPA rewrite.

**One gap is still open.** `npm run dev` serves `http://localhost:5173`, and the
committed `.env.local` points that dev server at the **remote** project. So a
password reset triggered from local dev sends
`redirectTo: http://localhost:5173/reset-password` to the *hosted* GoTrue, not to
the local one — where the `config.toml` fix does not apply. If
`http://localhost:5173/reset-password` is not on the hosted allow list, local dev
password reset is silently broken again, and nothing in the repo will show it.
The local stack masks the problem, which is why it is easy to miss.

### The recovery link, and why it is a fragment

The recovery link is a `303` to the app carrying `access_token` and `type=recovery`
**in the URL fragment**, with no `code`. That is what `flowType: "implicit"` and
`detectSessionInUrl: true` exist to consume, and it is why the fragment — not a
query parameter — is the thing that must survive.

Confirmed against production: `alg` is `ES256`, so the publishable key cannot
forge a session even if it leaks, and the `profiles` read through a
recovered session returns the user's own row and nothing else.

Turn that hash into a session with `setSession`, not `getSession(url)` —
`getSession` takes no arguments in supabase-js 2 and reads storage, so calling it
with a URL silently returns the *empty* session rather than erroring.

### Access model

Two roles, `admin` and `staff`, held in `profiles.role` as text with a `check`
constraint rather than a Postgres enum. Everything below is enforced by RLS and
triggers, not by the client:

| | read | write |
|---|---|---|
| anonymous | nothing | nothing |
| staff | all reference data, **own** profile, **own** assignments | own profile only |
| admin | everything | everything |

Reference data means `categories`, `locations`, `assets`, `maintenance`. Staff
read all of it because an asset list is useless without knowing an asset's
category, but they do not edit it. Assets are inventory, not user content.

`anon` is granted **no privileges at all** on any of the 8 tables — not merely
"no matching policy". A policy mistake therefore cannot leak to unauthenticated
callers even in principle. There are no `anon` policies anywhere. The `revoke` on
`asset_credentials` had to be stated explicitly rather than assumed, because
Supabase's default privileges hand `anon` all seven privileges on a new table —
see The asset inventory.

### Why there are three separate protections

Each blocks a different attack, and none of the three subsumes the others:

1. **Grants** — `anon` holds nothing. Table-level, coarse.
2. **RLS policies** — the `admin`/`staff` split, per row.
3. **`protect_profile_role` trigger** — stops privilege escalation. `staff` can
   update their own `profiles` row, so a policy alone would let them write
   `role = 'admin'` on it. A policy cannot restrict *which columns* get written,
   only which rows, so this has to be a trigger.

A fourth, narrower one: there is **no INSERT policy on `profiles`**. Rows only
arrive via the `on_auth_user_created` trigger, which is `security definer`. A
self-service insert would let anyone fabricate a profile — including one with
`role = 'admin'`.

### Asset status follows the loans

`assets.status` has five values and only two of them are derivable from
`assignments`: `available` and `assigned`. `maintenance`, `damaged` and `retired`
are judgements a person makes, so the column cannot be replaced by a view — it is
a real column with a real workflow, and two triggers keep the two derivable values
honest. `20260927000500` adds both.

**It needs two, and the second is the one that matters.** A trigger on
`assignments` alone is not enough: `status` is a column a client can also write
directly, and nothing checked that write. Verified on a local stack before the
migration was written — inserting a loan and then running
`update assets set status = 'available'` both succeeded, which is the whole bug
the issue describes.

1. **`assignments_sync_asset_status`** — after insert/update/delete on
   `assignments`, moves the asset between `available` and `assigned`. Fires on the
   *transition* of `returned_at`, not on every update. Invoker rights: whoever can
   change assignments can already write assets, so no elevation is needed.
2. **`assets_guard_status`** — before insert/update on `assets`, refuses a `status`
   that contradicts the actual loans. `security definer`, unlike every other guard
   in `002`, and deliberately: `assignments_select_own_or_admin` only shows a
   caller *their own* loans and RLS there is `force`d, so an invoker-rights check
   would see an empty table and wave the contradiction through. Today that is not
   exploitable — `assets_write_admin` means only admins write `assets`, and an
   admin passes the `or public.is_admin()` arm — but that is a coincidence between
   two policies, not a property of the function.

**No trigger ever overwrites `retired`, `damaged` or `maintenance`.** Every
transition is conditioned on the status the row is in *now*: a loan only makes an
`available` asset `assigned`, and a return only makes an `assigned` asset
`available`. A retired asset stays retired while it is out on loan and after it
comes back. A blind overwrite would be worse than the inconsistency it replaced.

All three workflow guards reject with `23514` (`check_violation`), so a client sees
one recognisable code rather than three.

### Departments are reference data

`profiles.department` was free text, and free text stops being workable the
moment it becomes a list: the Add-user form offered a text box, so "IT", "it"
and "IT " were three different values and nothing in the database could tell.
`20260927000900_departments.sql` makes it a `departments` table with a uuid and a
`department_id` foreign key, in the same shape `categories` and `locations`
already had.

**The foreign key rather than a validated text column is the point.** A list the
database does not reference is a list it cannot enforce, and it drifts the first
time anything writes the column from outside the form. `assets.category_id` and
`assets.location_id` are uuid references for the same reason.

The backfill is verified on the local stack against realistic pre-migration data,
including the sloppiness a text column permits: 5 profiles holding `IT`, `IT`,
`  Finance  `, `""` and a hand-typed `Ops ` became **3** departments — the
duplicate collapsed, the whitespace was trimmed, the empty string stayed NULL
without creating a row, and the trailing space was cleaned up. A distinct-value
insert alone is not enough for the last case, because `Ops ` and `Ops` are two
distinct values and the join has to trim too.

### An unknown department at signup becomes NULL, on purpose

`handle_new_user` resolves the metadata `department` to a row if one matches and
drops it if none does. Creating the row instead would let **any anonymous
signup** invent entries in a table only admins may write — the function is
`security definer`, so a row it inserted would carry no policy decision at all.
The app has no signup route, but the GoTrue endpoint is still open, and the
sign-in form says so.

### The delete guard is load-bearing, and the database will not do it

`profiles.department_id` is `on delete set null`, deliberately, so a department
removed by some future path degrades into "not set" rather than breaking an
unrelated write. The cost is that **the database will happily delete a department
that still has people in it** and silently un-assign every one of them. Verified:
an admin deleting an in-use department got `DELETE 1` and the member became
NULL, with no error and no warning.

So `deleteDepartment` asks first and throws `DepartmentInUseError` with the
count. A cross-table check is not something a foreign key can express, which is
why the check is in the application rather than in the schema.

### Every write here needs `.select()`, for the usual reason

`departments_write_admin` is one `for all` policy, so for UPDATE and DELETE a
staff member's statement matches nothing and PostgREST still reports success —
verified: a staff `DELETE` returned no error and deleted 0 rows. `INSERT` is the
one operation that raises, because a row-level violation on the check is an
error rather than a filtered result. `createDepartment` and `deleteDepartment`
both use `.select()` and throw `NoRowsWrittenError` on zero rows, so "saved" on
the screen cannot mean "nothing happened".

### The module is `src/modules/departments/`

`pages/DepartmentListPage.tsx` and `services/departmentService.ts`, following
`src/modules/users/`. Its read is **not** gated on `isAdmin`, unlike the user
list's, and that difference is deliberate: `profiles_select_own_or_admin` hides
rows from a staff member, so that read has to be gated or a staff member is
handed a one-row list that looks broken. `departments_select_authenticated` is
`using (true)`, so the department read returns the same rows for everyone and
gating it would only make the page slower.

`UserListPage` reads `getDepartmentOptions()` for its two pickers, so the list
refills whenever the users list reloads and a department added in another tab is
available without a full page reload.

## The asset inventory

`src/modules/assets/` is issue #49. The issue was a specification — a ~30 column
Excel inventory plus a list, a form and a sidebar row — and it closed with
thirteen numbered blockers, several of which needed a decision rather than code.
Each is recorded below, because the reason is the part that matters and none of
it is visible in the resulting file.

### It is an `alter table`, not a `create table`

`public.assets` has existed since `001`, and `assignments.asset_id` and
`maintenance.asset_id` both `references assets(id) on delete cascade`. A `create
table` would fail with `relation "assets" already exists` and, forced through,
would take both dependent tables with it. So `01000` adds 21 columns and touches
nothing existing. `name`, `updated_at`, `purchase_price` and `supplier` were all
absent from the spreadsheet and all four are still there.

### Seven spreadsheet columns were left out, all for the same reason

Each is a second source of truth for something the database already owns, which
is the same reasoning recorded for `profiles.email` and `profiles.department`.

| Requested | Why not |
|---|---|
| `device_name` | `assets.name` is already `not null`. Two "what is this called" columns is the same question twice with no answer. |
| `notes` | `assets.description` exists. |
| `category`, `location` | `assets.category_id` and `assets.location_id` are already uuid FKs to `categories` and `locations`. |
| `sub_category` | `categories.parent_id`, added by the same migration, rather than free text on every row. |
| `current_location` | Reversed by `01100` — see below. |
| `device_condition` | `assets.condition`, already constrained to five values. |
| `usage_status` | Still absent. See below. |

**`current_location` is the one that changed its mind.** `01000` refused it
because a second location beside `location_id`, with nothing keeping the two in
step, is the kind of drift that needs a transition rule and an audit trail rather
than a nullable text column. `01100` adds it anyway, on request: a physical room
or desk changes faster than a picker can be kept current, and the honest cost is
that the two can now disagree. The column comment says so where the schema is
read, and the form's own field label is the free-text box rather than a picker.
Reverting to the `01000` position is a drop-column migration, not an edit.

**`usage_status` is the one worth arguing about.** The spreadsheet's column mixes
two axes: "In Use" and "Idle" are loan state, "Good" is condition, and "Service"
is maintenance state. The first is already `assets.status`, kept honest by
`assignments_sync_asset_status` and `assets_guard_status`; the second is already
`assets.condition`; the third is `status = 'maintenance'`. Adding a fourth
unguarded text column whose values can contradict the two that are enforced would
reintroduce exactly the inconsistency `00500` was written to remove. The list
therefore badges ten values across two columns, and **every one of them comes
from a check constraint** — there is no third axis to keep in step. `#50` asked
for it a second time and the answer did not change; the form shows the status
read-only instead.

### The workbook is the specification

`01200` exists because the request changed from "match the spreadsheet's
concepts" to **"match the spreadsheet's column headers"**, and the second is a
much bigger job. `IT Hardware Asset Database.xlsx` holds 14 sheets; 7 are the
category sheets the form switches on, and their row 1 is a title rather than a
header, so **the headings are on row 2**. The full set is:

| Sheet | Columns | The ones that drove schema |
|---|---|---|
| `COMPUTER` | 48 | `Processor_MFG`, RAM maker/type/speed/slot/channel/size, `Onboard (Y/N)`, `Storage_MFG`/`Type`/`Size`, `Model11`/`Type12`/`Size` for the attached display |
| `DISPLAY` | 30 | `Resolution`, `Panel Size`, and `VGA`/`HDMI`/`LAN`/`WIFI`/`USB` as **counts** |
| `NETWORK-DEVICES` | 41 | `Firmware` *and* `Firmware Version` as two columns, `RJ45 Port`, `SFP+ Slot`, `Console Port`, `Power Port` |
| `PERIPHERAL` | 33 | `Mac Address`, `IP Address`, `Capacity`, `Speed`, `USB`, `BT/Wireless`, `HDMI`, `LAN`, `WIFI` as counts |
| `UTILITIES` | 22 | `Size`; no network columns at all |
| `IOT` | 37 | `Firmware Version`, `Storage_MFG`/`Type`/`Size`, `Power Source` |
| `SERVER` | 37 | identical headings to `IOT`, including `Power Source` |

Two of these corrected a mistake rather than adding to it. **`NETWORK-DEVICES`
carries `RJ45 Port`, `SFP+ Slot`, `Console Port` and `Power Port`**, and
`NETWORK_LIKE` already shows all three port boxes for that category — so
`Power Port` was the only genuinely missing one. And the first pass at reading the
file, which parsed the XML by hand, **missed all four**; the sheet has 41 columns
and a hand-rolled reader reported 26. openpyxl is the parser that produced the
table above, and it is the reason to reach for a library rather than a regex
over `sheet1.xml`.

#### The ports are counts, and 01100 had modelled them as names

`01100` stored `input_ports text[]` and `connectivity text[]` — arrays of port
*names*, for a checkbox. The workbook holds *numbers in one column per port*:
`HDMI = 3`, `VGA = 1`, `RJ45 Port = 10`. Those are different facts, and one
string array cannot hold both. `01200` therefore added ten `port_* integer`
columns and **dropped the two arrays**, which is the one destructive statement
in the migration and is why the file guards it: the `do` block counts rows
carrying array data and raises rather than dropping data on the remote, where
there is no re-apply path. The count was 0 on the remote when it was written,
and `assets` was empty, so nothing was lost.

`gpu_onboard` is a `boolean` for the workbook's `Onboard (Y/N)`, which is the one
Y/N heading in the file.

#### `Storage_Size` is one heading with three shapes

The same column holds `512`, `120GB` (NETWORK-DEVICES), `2x 4TB` and `4x 12TB`
(SERVER). An integer column cannot carry the last three, so there are two:
`storage_size_gb integer` and `storage_size_text text`. The form shows **one
box**, and `normalise` splits it with `/^\d+$/` — exactly one of the pair is ever
non-null. This is the only place in the module where a single input is written to
two columns, and it is deliberate rather than an oversight.

#### `Firmware` and `Firmware Version` are not the same heading

`NETWORK-DEVICES` has both: `Firmware` holds a platform name (`CISCO`,
`FortiGate`) and `Firmware Version` holds `4.1.3.36`. `01100` had one column, and
it is the version one, so `firmware_platform` is new and the version stays in
`os_or_firmware_version`.

#### `usage_status` is now a column, and it is still not `status`

`#50` asked for it and `01100` refused it, on the grounds that it duplicated
`assets.status` and could contradict it. The workbook is the specification, so
`01200` adds it — with the reasoning intact rather than discarded. It is a
**separate column from `status`**, the triggers never read it, and the overlap is
stated in the form:

| | who owns it | what it means |
|---|---|---|
| `status` | `assignments_sync_asset_status` and `assets_guard_status` | the loan state, derived from the actual loans and not writable by hand |
| `usage_status` | a person, through the form | the workbook's own record, a closed set of `In used by User` / `Idle` / `Shared` / `Lent out` |

`Lent out` describes the same real-world situation as `status = 'assigned'`, and
the two are **not kept in step**. The constraint is the workbook's value set
verbatim, so a lower-cased spelling is refused with `23514` — the same closed-set
reasoning as the array check `01100` added, and verified on the local stack.

#### The sub-categories are the workbook's, and the old ones were left alone

`01100` seeded 23 sub-categories that the workbook does not list. `01200` inserts
the 14 the file actually uses (`PC`, `Notebook`, `Handheld`, `AIO`, `TV`, `MK SET`,
`Headphone`, `Speaker`, `External Storage`, `Keyboard`, `Bracket TV + Port
Electric`, `Network Tools`, `AI & Compute`, `Surveillance & Autogate`) and
**deletes nothing**, because `assets.category_id` may point at an old row and
`categories.name` is UNIQUE so a rename could collide. The table now holds both
sets, 37 children in total.

The workbook's only `SERVER` sub-category is `Server`, which is the parent's own
name, so `categories_name_key` forbids it. An asset with no sub-category stores
the parent directly on `assets.category_id`, which is the rule the form already
followed.

#### Two headings are deliberately not columns

- **`Credential - Username` / `Credential - Password`** are in the workbook on
  NETWORK-DEVICES, IOT and SERVER, and they stay in `asset_credentials`. The
  reasoning is unchanged and is the strongest of the three: `assets` is readable
  by every signed-in user, RLS filters rows and not columns, so a device password
  on `assets` is in every staff member's list response. The form shows them on the
  admin-only Credentials tab instead, so the capability is present and the
  exposure is not.
- **`img_1` / `img_2` / `img_3`** are in six of the seven sheets and are empty in
  every one of them. They are image attachments, and this project has no
  Supabase Storage bucket, no upload path and no storage policy. Three text
  columns holding paths would be a promise the app cannot keep. Adding a bucket is
  its own piece of work and its own set of RLS decisions.

#### COMPUTER got a real fieldset, and the generic one is still reachable

`COMPUTER` now shows the workbook's 15 spec fields rather than four free-text
boxes, and keeps `processor_spec` because the sheet's `Specifik` column is a
distinct heading from `Model` and `Processor_MFG`. A category with no `code` —
one an admin added after the seed — still gets the generic fieldset, so nothing
leaves a tab empty.

### Credentials are a separate table, and it is the only reason the table exists

`assets_select_authenticated` is `using (true)`, so every signed-in user reads
every asset row. Two columns on `assets` would put a plaintext device password
into the response of every list request, for staff, whether or not anyone asked
for it. RLS cannot prevent that: **a policy filters rows, not columns**, and no
policy can stop a permitted row from carrying a field you did not want read.

A separate table is the one lever RLS does give, and it was verified rather than
assumed. Through PostgREST, on the same query with the same embed:

| Caller | `assets(*, credentials:asset_credentials(*))` |
|---|---|
| admin | `credentials: { username, password }` |
| staff | `credentials: null`, asset rows intact |

That is the whole design, and it cost staff nothing they had. `asset_credentials`
is admin-only for read and write, with **four policies rather than one `for
all`**, so the `insert` case does not depend on a `using` expression with no row
to read yet.

**The password is plaintext at rest.** It is behind an admin-only read rather
than encrypted, which is a real improvement over putting it on `assets` and not
the same as being safe. Encrypting it properly needs a key living outside the
database, which means an Edge Function to decrypt on read, and this project has
no such key. Until one exists, "who can read a device password" is a
database-admin question rather than an application one. The form says so too, and
tells the admin to leave the boxes empty and use a password manager instead.

### `anon` needed an explicit revoke, and skipping it looks like it works

The first version of `01000` granted `authenticated` and left `anon` alone. It
passed `db reset --local` and every RLS assertion, because Supabase's default
privileges already grant `anon` all seven privileges on a new table in `public`
and there is no `anon` policy — so queries came back **empty**, which reads
exactly like correct. The mistake was only visible by reading the grant list
directly: `information_schema.role_table_grants` showed `anon` holding select,
insert, update, delete, truncate, trigger and references. The project rule is that
the *grant* is the first line of defence and the policy is the second, so a table
that relies on RLS alone is quietly weaker than every other table here.

### The delete is guarded, and that is a deliberate third option

`assignments` and `maintenance` both cascade, so an unguarded delete would take
the loan history and the service record with it — the same loss the hard-delete
warning in user management spells out for accounts. The issue offered hard delete
with a warning, soft delete, or a guard. **The guard won**, because unlike user
deletion it is cheap: an asset with no history is safe to remove, and one with
history is worth keeping. Soft delete was the loser because it adds a `status`
value that `assets_guard_status` and the maintenance guards would then have to
be taught about, which is a larger change to the part of this schema that was
built carefully.

`AssetInUseError` carries both counts so the refusal can name what is in the way,
the same shape as `DepartmentInUseError`.

**The assignments count is only trustworthy for an admin**, because
`assignments_select_own_or_admin` shows a staff member only their own loans. That
is not a hole — `assets_write_admin` refuses the delete itself either way — but it
is why the refusal is not the security boundary. `assets_write_admin` is.

### Status is not in the form, and `assigned` is not offered anywhere

`assets_guard_status` compares a submitted status against the actual loans, so a
form offering `assigned` would offer a value the database refuses with a check
violation the admin cannot act on. Two consequences in the code:

- `createAsset` and `updateAsset` do not send `status` at all. A new asset lands
  on the column default, the only status a brand new asset can honestly be.
- `setAssetStatus` takes `SelectableAssetStatus`, which is
  `Exclude<AssetStatus, "assigned">`. The one value the loans own cannot even be
  passed, and it has its own control offering only the three nobody can derive.

Verified on the local stack, all of it: an asset **cannot be inserted** as
`assigned` (the guard fires on insert too, which is worth knowing); a loan moves
it there; `assigned` with no loan, `available` on a loaned asset, and
`maintenance` on a loaned asset are each refused with `23514`; and a `retired`
asset stays `retired` through a loan and a return, because no trigger overwrites
it.

### The form is five tabs, and two primitives were deliberately not used

~30 fields in one scrolling form is one nobody finishes, so it is tabbed:
Identity, Specification, Network, Credentials, Administration, with Identity
open. The issue's grouping was followed.

- **`Input type="date"` rather than the `DatePicker` primitive.** `DatePicker`
  wraps flatpickr, which owns its input and hands back hook objects rather than a
  value, so it does not fit a controlled form. A native date input is controlled
  and produces the `YYYY-MM-DD` the `date` column wants. The primitive is still
  one of the 13 and is not dead — it is just the wrong shape for this field.
- **`Select` and `Switch` need a `key`.** Both keep their selection in
  `useState(defaultValue)`, which reads it once. Reused across a modal that edits
  different rows, the second asset would show the first asset's choice. Every
  `Select` in this form is keyed on the row being edited, and the filter selects
  are keyed on the current filter value so clearing one actually resets it.

### The form switches on a category code

`01100` is issue #50. The five tabs still exist; what changed is that
**Specification** and **Network** render a fieldset chosen by the *main* category
instead of the same fields for every asset.

**`categories.code`, not `categories.name`.** A name is editable and a rename
would silently empty a fieldset, so the form must not key off one. `code` is
nullable, seeded for the seven parents, unique, and survives a rename. Verified:
renaming `COMPUTER` to `COMPUTERS` leaves the code, and the fieldset with it. A
category with no code — one an admin added after the seed — falls back to the
common fields rather than breaking.

An earlier version of this file justified that with the seed carrying two rows
named "UPS", one under `PERIPHERAL` and one under `SERVER`. **That is not
possible** and never was: `categories_name_key` is `UNIQUE (name)`, verified in
`pg_constraint` on both databases, and the seed resolves only 23 sub-categories
with exactly one `UPS`. The decision stands on the rename argument alone, which
is enough on its own — but do not reach for the duplicate-name example again.

| `code` | shows |
|---|---|
| `COMPUTER` | the workbook's 15 spec fields: processor maker/model/spec, six RAM fields, GPU model and onboard, storage maker/type/size, three display fields; plus hostname, four IP/MAC boxes, OS, product key |
| `DISPLAY` | resolution, panel size; VGA / HDMI / LAN / WIFI / USB counts |
| `PERIPHERAL` | capacity, speed; hostname, one IP and one MAC; USB / BT-Wireless / HDMI / LAN / WIFI counts |
| `NETWORK_DEVICES`, `SERVER`, `IOT` | storage maker/type/size, RJ45 / SFP+ / console / USB / power counts; hostname, four IP/MAC boxes, firmware, connection type, management URL. `NETWORK_DEVICES` adds `Firmware` platform, `IOT` and `SERVER` add `Power Source` |
| `UTILITIES`, or no code at all | the original generic specification and network fields |

`NETWORK_LIKE` is a `Set` rather than three separate branches because the three
categories share one fieldset. Anything outside all four groups is `isGeneric` and
gets the generic set, so **no category can leave a tab empty** — including a
category invented after this was written.

**The switch is on the main category, never the sub-category.** `parent_id is
null` is what makes a row a parent. The form resolves `parent_category_id` from
the asset's own category and the sub-category only refines the label, so an asset
with no sub-category stores the main category directly on `assets.category_id`.
That is why `toInput` sends `category_id || parent_category_id`, and why picking a
new main category clears the sub-category: the chosen child belongs to the parent
just left.

**The port counts are `integer` columns, one per port, not a name array.** This
is a correction rather than a preference: `01100` modelled them as `text[]` of
names for a checkbox, and the workbook holds a number in its own column
(`HDMI = 3`). "HDMI" and "3" are different facts, and an array cannot hold both.
`01200` added the ten `port_*` columns and dropped the two arrays.

**Every count is validated before the save, not after the failure.**
`handleSave` rejects anything that is not `^\d+$`, because the column check would
otherwise refuse the whole write with a message about ports and no idea which
box. The rejection is one i18n key, and it is the same shape as the existing
price check.

#### Two columns #50 asked for that are not what the issue assumed

- **`usage_status` is still absent, and now that is a decision rather than an
  omission.** See the `usage_status` row in the seven-skipped-columns table. The
  form shows the status **read-only** in the Administration tab instead, because
  an admin opening a form still wants to know where the asset stands — with the
  list's status control as the one place to change it, since `assets_guard_status`
  refuses `available` and `assigned` from a form.
- **`protocol_url` is on `assets`, which means every staff member can read it.**
  The issue asked for it beside the network fields, and `assets` is where the
  network fields live, so that is where it went.
  `assets_select_authenticated` is `using (true)`, so a URL that embeds a
  credential — `rtsp://user:pass@host/…` — leaks that credential to every signed-in
  user. The alternatives were a credentials-shaped table (one per category, to
  hold a field that is not really a secret) or warning rather than preventing. The
  owner chose the second, so the form says so in a warning under the box and the
  column comment repeats it where the schema is read. Do not "fix" this by quietly
  moving the column.

**`current_location` was added on request and can diverge from `location_id`.**
The spreadsheet's `current_location` is a free-text room or desk; `location_id` is
the registered location. Nothing keeps the two in step — the same kind of
inconsistency that made the delete guard necessary, and unlike `status` this one
is not enforced at all. It was added anyway, because a physical location changes
faster than a picker can be kept current, and the column comment says so at the
point where someone reads the schema. If it starts causing arguments, the fix is
a transition rule and an audit trail, not a second nullable text column.

### The list is readable by everyone, and that is the opposite of `/users`

`/users` and `/departments` refuse to render for a staff member. This page does
not, and the difference is deliberate: stock belongs to the company rather than to
one department, and `assets_select_authenticated` is `using (true)`, so gating the
read would hand every staff member an empty page. The only thing a staff member
loses is the Credentials tab and the write actions, and the credential they cannot
read was never in the response.

Filtering happens in the browser over the already-fetched list, the same approach
`UserListPage` takes — a query per keystroke would be slower and would need the
filter state to survive a reload.

### Not done, and why

- **Assignments and maintenance have no UI at all.** `01000` depends on both
  tables existing, but nothing in `src/` creates a loan or schedules a repair.
  Until that lands, `guard_maintenance_assignment` and the delete guard's refusal
  are both only reachable from SQL. The status control offers `maintenance`, which
  is legitimately a person's judgement, but there is no work order behind it yet.
- **Categories and locations now have an admin UI**, in `src/modules/asset-settings/`.
  That entry is stale in the sense that it is no longer true; it is kept only so
  the gap it describes is not re-raised. See Asset settings manages the reference
  data for what replaced it and why the tables were not recreated.
- **No `useIsAdmin` gate on the read**, deliberately, unlike both other modules.
- **The dynamic form has not been driven in a browser.** It was verified at the
  database layer (15 assertions on the constraints, the RLS split and the seed)
  and at the build layer (`tsc`, `eslint`, Prettier), and the fieldset logic is
  read off the `code` groups in this file rather than observed. What that leaves
  untested is the rendering half: that each of the seven main categories shows its
  own fieldset, that editing a row rehydrates the same set, and that an admin
  switching a sub-category does not lose the values the old main category owned.
  A REST-level round trip does not cover any of those, which is why this is listed
  rather than claimed as done.
- **`/asset-settings` has not been opened in a browser either.** The 10 database
  assertions and the RLS split are verified; the two tabs, the three modals and
  the disabled-delete states are only build-verified. Three bugs shipped from here
  to the browser uncaught — the dropped `locations.name` in the asset read, a
  sidebar predicate that removed User Management for admins, and a table whose
  cells had no padding at all so the text sat flush against the card border — so
  treat the first click-through as the real test.

## Asset settings manages the reference data

`src/modules/asset-settings/` is issue #51: the admin screen behind the asset
form's category and location pickers.

### Categories belong to a unit

`01400` adds `categories.department text not null default 'IT'`, so the asset
settings screen can show one unit at a time and the reference data can grow past
the IT inventory. Four decisions, and the third is the one that was not asked for.

**The name is a deliberate collision, and it is a trap.** `departments` already
exists in this schema and `profiles.department_id` points at it: that is the
department of a *person*. `categories.department` is the unit that owns a
*category*. Both may hold "IT" and nothing joins them, so the column comment says
so where the schema is read. A reader who assumes they are the same thing will be
wrong, and nothing will tell them.

**Uniqueness moved from global to per-unit.** `categories_name_key` was
`UNIQUE (name)` **globally**, which is exactly what stops HSSE having a `Monitor`
while IT already has one — the second insert is refused with `23505`. It is now
two partial unique indexes: `categories_department_name_key` on
`(department, name)` for a top-level category, and `categories_parent_name_key`
on `(parent_id, name)` for a sub-category. The migration is safe on the existing
data because no name is currently duplicated, verified with `group by name having
count(*) > 1` returning nothing; a duplicate would fail the `CREATE INDEX` rather
than merge two rows silently.

**The dropped index was a constraint, not an index.** `categories.name` was
declared `text not null unique`, so the uniqueness is a table constraint and
`drop index` is refused with `2BP01`. It needs `alter table … drop constraint`.
This is the same trap as the `20260927001400` note below and it will bite anyone
who assumes a `UNIQUE` constraint and its index are separable.

**Two guards, and neither was requested.** Without them the department filter is
quietly broken rather than loudly wrong:

- `guard_category_parent` also refuses a sub-category filed under a parent from a
  **different unit**. Without it, a child with `department = 'HSSE'` under
  `COMPUTER` is invisible in the IT view and appears in the HSSE view with **no
  parent above it** — an orphan row with nothing to expand and nothing on screen
  to say why. Verified: the cross-unit insert is refused, and a count of
  `child.department <> parent.department` returns 0.
- `categories_guard_department_change` refuses moving a parent **between units**
  while it still has sub-categories, which would strand exactly those children.
  Verified: moving `COMPUTER` is refused, moving a childless parent is allowed.
  Worth knowing that this means **no seeded parent can be moved** — all seven
  have children.

**`DEPARTMENTS` in `settingService.ts` is a list and the column is free text.** A
`check` constraint would be wrong the first time somebody spelled a unit
differently, and an enum needs a migration to extend, so the column is free text
and the list lives in the form. The cost is that the list is the one place a new
unit has to be added, and a unit in the database but missing from the list is
simply not selectable. The column comment says the same thing.

**The asset form is filtered to `IT`, and that is not a filter you can forget.**
`getAssetFilterOptions` reads all categories, so without
`ASSET_DEPARTMENT = "IT"` an HSSE category would appear in the asset form's
dropdown for everyone. It is a constant rather than a setting because the
inventory *is* the IT one: the seed came from the IT hardware workbook and the
fieldsets were built from those seven sheets. A category from another unit has no
fieldset, so an asset filed under one would silently get the generic fields. When
HSSE assets are actually tracked, the thing to change is this constant **and** the
fieldset groups — not this alone.

### The unit filter sits in the tab strip, not the table toolbar

The request was for it beside the Categories/Locations tabs, and that is where it
stays. In the toolbar it collided with the Collapse and Add buttons on a phone:
that row already carries three controls and the sentence beside it takes whatever
space is left. The row is `flex-wrap` with `justify-between`, so the tabs sit left
and the selector drops to a full-width line underneath on a narrow screen rather
than becoming two cramped bars.

**The selector is hidden while Locations is on screen.** It filters the category
list and nothing else, so showing it over Locations would be a control that looks
like it does something and does not. It is keyed by the current value, because
`Select` reads `defaultValue` once and would otherwise keep showing the unit
loaded at mount.

**The parent picker in the modal is filtered to the unit on screen**, not just the
table, because a sub-category must be filed under a parent from its own unit.
`categories_parent_name_key` and `guard_category_parent` both enforce that, so
offering a cross-unit parent would only produce a `23514` the admin has to decode.

### The asset form switches on the unit

`01500` is the second axis on the asset form. Until now the fieldset was chosen by
the **main category's code**; it is now chosen by the **unit** first and the
category within it, because HSSE categories have no code and would otherwise fall
through to `isGeneric` and be handed the IT fields.

### Only four columns are new

The request listed a full set of "common" fields for the HSSE form. Fifteen of them
already exist: `asset_code`, `name`, `category_id`, `location_id`,
`purchase_date`, `condition`, `asset_pic`, `serial_number`, `manufacture`,
`model_name`, `model_type`, `short_name`, `description` and `capacity`. So the
migration adds four — `expiration_date`, `last_inspection_date`,
`next_inspection_date` and `calibration_cert_no` — and the form reuses the rest.

**Plain columns, not a `jsonb specifications` blob.** The request offered
`jsonb` as the flexible option. It is the wrong shape for four fields whose types
are already known: a free-form column accepts `"31/12/2026"` beside a real date
with nothing to object, and it makes "expire within 30 days" unindexable. The
reasoning is the one already recorded for `usage_status` and `locations.name`.
Verified on the local stack: a non-date `expiration_date` is refused.

`next_inspection_date` is a **separate column rather than derived** from the last
one plus an interval, because the interval is a policy rather than a fact, and
policies change without a migration being the right place to record it.

### The asset's unit is derived, and the trigger overwrites rather than refuses

`assets.department` exists so the list can filter by unit without a join, and
`assets_sync_department` copies the category's unit onto it. **The client never
writes it.**

Overwriting was the decision over raising on a mismatch, and the reason is
specific: a client cannot distinguish "the caller did not send this column" from
"the caller sent the default", so an honest insert that omits `department` and
points at an HSSE category would be refused for a disagreement nobody made.
Overwriting makes disagreement impossible by construction, for every writer
including a service-role one.

**The trigger fires on `update of category_id, department` — both.** The first
version fired on `category_id` only, and `update assets set department = 'IT'`
then wrote straight past it; the local-stack check caught it, because an `UPDATE OF`
list only fires when the named column appears in the SET list. A column that is
only ever meant to be derived still has to be named, or nothing stops a direct
write to it. That is the same mechanism as `profiles_protect_email` being
`before update of email` and `profiles_guard_last_admin` being `of role`.

### Switching unit clears the category pickers

The chosen category belongs to the unit it was chosen in. Keeping it would leave a
`COMPUTER` id in a form showing HSSE fields, and the trigger would then quietly
file the asset under IT. So `handleChangeDepartment` clears both the parent and the
sub-category, the same reason the sub-category is cleared when a parent changes.

**Hiding is not clearing.** An IT asset whose fields are hidden keeps them in the
database as NULL-or-value; if the unit is later switched back to IT, the form starts
from empty rather than restoring them. That is the accepted behaviour, and it is
the reason nothing in `handleChangeDepartment` writes to the IT fields.

### The category pickers are filtered by unit in the UI *and* the unit is derived in the database

The form's `parentOptions` and `childOptions` both filter on
`CategoryOption.department`, and `getAssetFilterOptions` now returns **every** unit
rather than only IT — a SQL-side filter would have left the other unit's pickers
permanently empty. Together with the trigger that is the "both" option rather than
either half: the UI makes the wrong pair hard to pick, and the trigger makes it
impossible to store.

### The category list collapses, and the state is a `Set` of ids

Each parent row carries a chevron that hides its sub-categories, plus one
`Collapse all` / `Expand all` button. Both are here because the list is going to
grow: a flat parent-plus-children table with dozens of children is a wall, and
the two levels stop being visually distinct once the wall is long enough.

Three decisions that are not obvious from the code:

- **Every group starts open.** The collapsed set is empty on load. Defaulting to
  collapsed would hide data behind a control on first sight, which is the
  confusion the feature exists to remove.
- **A parent with no sub-categories has no toggle at all**, not a disabled one.
  A control that looks actionable and is not is the same problem. A `size-5`
  spacer keeps the names on one left edge so both kinds of row still line up.
- **`allCollapsed` is measured against `collapsibleIds`, not `collapsedIds.size`.**
  A collapsed id left over from a category that has since been deleted would
  otherwise make the button claim everything is closed while a group still showed
  its children. Verified in isolation: toggle, double-toggle back to open,
  collapse-all, expand-all, and a stale id not counting.

**A collapsed group is not rendered, not hidden with CSS.** `!isCollapsed && …`
rather than a `hidden` class, so the rows are absent from a screen reader's row
count and from `Ctrl-F` instead of present but invisible.

### The three tables were not created, and that was the whole finding

The issue asked for `asset_categories`, `asset_sub_categories` and
`asset_locations`. **All three already existed** under other names —
`categories` (holding both levels through `parent_id`) and `locations` — and
`assets.category_id` and `assets.location_id` already reference them. Creating a
parallel set would have been a second source of truth for two facts the database
already owns, which is the same argument that removed `profiles.department` as
free text and that keeps `usage_status` a separate column rather than a rename.

Two of the three were therefore not a table at all:

- **`asset_sub_categories` is `categories WHERE parent_id IS NOT NULL`.** The form
  already resolves a sub-category's parent from one flat read.
- **`categories.description` already existed**, so that column needed no
  migration either.

What `01300` *does* change is `locations`, and it is the real work of the
migration.

### `area_name` + `room_name`, and why `room_name` is nullable

The request asked for `room_name text not null`. It is nullable here, because an
area is a legitimate value on its own — a laptop assigned to a site has no room,
and a `not null` room forces the field to hold "N/A", which is a null written as
a string and is worse than a null. This is the same reasoning as `comment on
public.assets.storage_size_text` and as the `location` column in
`20260927000600_profiles_email.sql`.

`locations.name` is **dropped**, not left beside the new pair: three columns for
two facts is the problem this project keeps refusing to add, and every caller read
`name` today, so leaving it would let the two disagree with nothing saying which
is right. `address` is likewise folded into `notes` — the same field under a
vaguer name, read by nothing.

The three rows `01100` seeded (`Head Office`, `Server Room`, `Gudang IT`) become
`area_name` with a null `room_name`. "Server Room" reads as a room by name, but
nothing in the seed says which area it sits in, so inventing a parent for it
would be a guess in a migration.

**Two indexes, not one, and the second is not optional.** The natural uniqueness
is `(area_name, room_name)`, but `null` is distinct from every other `null` in a
Postgres unique index, so two room-less rows for the same area would both be
allowed. `locations_area_only_key` is a partial unique index over `area_name`
where `room_name is null`, and that is what actually stops it. Verified on the
local stack: a second `Jakarta HO` with a null room is refused, while a second
*named* room in `Patimban` is allowed, because those are two different places.

The display string is **assembled in the client**, not stored:
`LocationOption.name` in `assetService.ts` is `"Patimban / Customs Building"`, or
just the area when there is no room. A picker wants one line of text and the
database should hold the two facts.

### The category delete guard, and the one the application also needs

`assets.category_id` is `on delete set null`, exactly like
`profiles.department_id` was, and for the same reason — a deleted reference
should degrade into "not set" rather than break an unrelated write. The cost is
identical and documented under Departments are reference data: **the database will
happily delete a category that still has assets in it and silently un-assign every
one of them.**

So `01300` adds `categories_guard_delete`, a `before delete` trigger that counts
sub-categories and assets and raises `23514`. It is `security definer` and pins
`search_path`, both for the reasons the other guards do. The cross-table count
cannot be a foreign key, and it cannot be an RLS policy either, because the
client is the only thing that knows which rows the caller may see — so
`deleteCategory` in `settingService.ts` *also* asks first and throws
`CategoryInUseError` with both counts. The trigger is what holds for any caller
including a service-role delete; the application check is what produces a message
naming what is in the way.

### `guard_category_parent` exists because a third level would break the fieldset

The form switches its fieldset on the **main** category's code, resolved by one
hop: an asset with a sub-category stores the child, and the child's `parent_id`
is the main category. A third level would make that lookup point at *another
child*, and the form would silently pick the wrong fieldset rather than fail. The
trigger refuses a sub-category whose parent is itself a sub-category.

`categories_code_only_on_parents` is the companion: a sub-category must not carry
a `code`, because the form only honours one on a parent. Note the direction — a
**parent with no code stays legal**, since that is the documented fallback for a
category an admin added after the seed.

### Writes are admin-only, and that departs from the request

The issue asked for "read & write for authenticated users". Writes are admin-only
here, matching `assets_write_admin` and the existing policies on both tables.
Reference data is read by every staff member — the asset form's pickers need it —
and written by admins alone; a staff member who could edit it could silently
re-point every asset in a category.

The screen is gated the way `/users` and `/departments` are: `useIsAdmin()` in
the page, no second route guard. RLS is the boundary; the gate is only there so
staff are not shown a screen that cannot work. The sidebar entry carries
`adminOnly` **on the sub-item** rather than on the group, because the group mixes
the open-to-everyone asset inventory with this admin-only screen, and `NavSubItem`
gained an `adminOnly` field to carry it.

### The self-embed trap applies here too

`getCategories` reads `categories` flat and joins `parent_id` in memory, for the
reason `getAssetFilterOptions` does: `parent:categories!categories_parent_id_fkey`
is the documented hint for that FK and PostgREST refuses it with `PGRST200`, while
the accepted forms resolve the *inbound* direction and return an empty array
instead of the parent. Do not "simplify" this into an embed.

## User management

`src/modules/users/` is the **one** feature module that is a whole feature (the
departments one is a list). It is a **read, edit, create, role-change, and
password-reset** screen: list every account, search, edit a name and a
department, change a role, add an account, delete an account, and hand somebody
a new password. The last three need the Admin API and therefore an Edge
Function; see Creating an account, Delete, and Resetting a password.

### Editing the name and department, and why it needs no migration

`full_name` and `department` are editable by any signed-in user on their own
row, and by an admin on any row — `profiles_update_own` already says so. What
makes the question worth answering is that **`profiles` has three triggers, and
none of them can be tripped by this write**.

`updateUserDetails` sends exactly two columns, and that is load-bearing:

| Trigger | Fires on | Why it is inert here |
|---|---|---|
| `profiles_protect_email` | `before update **of email**` | An `UPDATE OF` trigger only runs when the column appears in the statement's SET list. `email` is not sent. |
| `profiles_guard_last_admin` | `before update **of role**` | Same mechanism. `role` is not sent. |
| `profiles_protect_role` | `before update` (no `OF`) | This one *does* fire, and it is the reason the write is not simply "unprotected". It raises only when `new.role is distinct from old.role`, and the function never touches `role`, so it returns early. |

So the guarantee is not that the columns are unguarded — it is that the guards
are all column-scoped and this write is scoped away from them. Adding `role` to
the payload would change that immediately, which is why role is a **separate
control with its own modal** rather than a third field in the details form.
Verified locally in 9 assertions, including that a details-only write leaves
`email` and `role` byte-identical and that an admin editing their own name keeps
their admin role.

The one honest gap: `.select()` rather than a bare `.update()`, because RLS
answers a non-permitted write with **zero rows and no error**. A resolved
promise is not proof, so `NoRowsUpdatedError` is thrown when no row comes back
and the screen says so.

### Delete, and why the cascade cannot do the work

Delete needs `supabase.auth.admin`, so it lives in a second Edge Function,
`supabase/functions/delete-user/`, for the same credential reason as
`create-user`. It is a **hard delete**, and the cascade is what an admin has to
be told about before pressing the button:

| | |
|---|---|
| `assignments.user_id` `on delete cascade` | the person's loan history is erased, returned ones included |
| `assignments.assigned_by` `on delete set null` | the record of which admin lent out each of those assets is lost |
| `assignments_sync_asset_status` | every asset they were holding goes back to `available` with no history of who had it |

The confirmation modal lists all three rather than saying "this cannot be
undone", and the outcome reports how many loan records went with the account.
A deactivation flag would avoid all of it, and needs a new column plus a
decision about live sessions — not built.

**It is a hard delete because that was the decision, and it is guarded where a
cascade would otherwise not be.** `guard_last_admin` is `before update of role`;
a delete is not an update, so the cascade walks straight past it and would
remove the last admin with nothing to stop it. Two refusals sit in front of
that: you may not delete the account you are signed in with, and you may not
delete the last remaining admin.

**The `last_admin` check is currently unreachable, and the comment in the
function says so.** The caller has already been proven to be an admin, so if the
count is 1 the only admin *is* the caller and any admin target is the caller —
`self_delete` fires first. It is kept as a safety net for the day someone
relaxes the self rule. If it ever does fire, that is a finding about the self
check rather than a routine refusal.

An earlier version of that check was **wrong in a way that looked like caution**:
it refused *any* delete while the project had a single admin. The risk is only
when the target is that admin, so the condition is `target.role = 'admin'`. As
written it made every staff account undeletable in a fresh project, which is
exactly the shape a new install is in.

### Why a hard delete cannot rely on the cascade

`profiles.id` is `references auth.users(id) on delete cascade`, which reads like
the cleanup is free. It is not, and `auth.admin.deleteUser` **always fails** on
any user with a profile. Verified on the local stack before the function was
written:

```
profiles: relrowsecurity = t, relforcerowsecurity = t
policies on profiles: profiles_select_own_or_admin (SELECT), profiles_update_own (UPDATE)
```

There is **no DELETE policy on `profiles` at all**. The cascade runs as
`supabase_auth_admin`, which has `bypassrls = false`, against a table with
`force row level security`. So it deletes zero rows, the `profiles` row survives
pointing at an `auth.users` row that no longer exists, the foreign key is
violated, and GoTrue reports the whole thing as:

```
Database error deleting user
```

Which is a genuinely bad error message: it names the database, not the policy,
and looks like a schema problem rather than an RLS one.

`delete-user` therefore removes the rows itself, in order, and deletes the auth
user **last**: `assignments` first because `profiles` cannot go while a row still
references it, then `profiles`, then `auth.users`. The service role bypasses
RLS, and the triggers it fires behave exactly as they do for any other privileged
write — `assignments_sync_asset_status` still flips the assets back, which is the
point.

The alternative — granting `DELETE` on `profiles` and `assignments` plus
`UPDATE` on `assets` to `supabase_auth_admin`, and adding a DELETE policy to a
table that deliberately has none — was rejected. It widens what the auth role can
do in the database to work around a limitation of one function.

The same trap is why **no delete was ever possible from the browser**: there is
no policy a signed-in user could be granted, by design. See Why there are three
separate protections.

### CORS is the function's job, and the local stack hides the bug

`supabase.functions.invoke` sends the caller's JWT, and an `Authorization` header
makes the request non-simple, so the browser sends an `OPTIONS` preflight first.
**The Supabase gateway does not answer that preflight** — it passes `OPTIONS`
through to the function, which has to reply with
`Access-Control-Allow-Origin` itself.

Answering it with an ordinary refusal is therefore silently fatal. This is what
happened: `if (req.method !== "POST") return json(405, …)` answered the
preflight with a 405 carrying only `Content-Type`, the browser dropped the
request, **the real `POST` was never sent**, and the console reported

```
blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

while `curl` reached the function fine and the logs showed nothing wrong. The
symptom looks like a network problem; the cause is a missing `OPTIONS` branch.

**`Access-Control-Allow-Headers` has to name every header the SDK sends, and
that list grows.** The same file added `authorization, content-type`, which was
correct until `supabase-js` 2.117 added `X-Client-Info` to every request —
confirmed in the bundle as `DEFAULT_HEADERS = { "X-Client-Info": … }` — and the
preflight started failing again with

```
Request header field x-client-info is not allowed by Access-Control-Allow-Headers
```

A hand-maintained list is a list that will be wrong again. `supabase-js` ships
the answer as a subpath export, kept in step with the client and checked by the
SDK's own tests:

```ts
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
```

It exports `authorization, x-client-info, apikey, content-type, x-retry-count,
traceparent, tracestate, baggage` — all eight — plus a wildcard origin. Import it
rather than copying the list, and note the failure mode: it only goes stale when
the dependency is upgraded, at which point a redeploy is happening anyway.

**The wildcard origin is correct here, and that is worth defending rather than
assuming.** The boundary on this endpoint is the admin check, not the Origin: the
caller's JWT is the credential, and a page on another site cannot obtain it,
because it lives in storage only this app's own origin can read. An origin
allowlist adds no protection to that and adds one more reason for the button to
not work on somebody's machine. The platform's own gateway already answers its
errors with `Access-Control-Allow-Origin: *`. If sessions ever move to cookies,
revisit — a cookie *is* attached automatically, and then the Origin check starts
to matter.

Two things made the original bug survive as long as it did:

- **`OPTIONS` skips the gateway's JWT check.** `POST` with a bad or missing
  token is answered by the gateway with `{"code":"UNAUTHORIZED_…"}` and its own
  `Access-Control-Allow-Origin: *`; `OPTIONS` sails straight through to the
  function. So the one request the function was about to get wrong was the only
  one the gateway did not screen.
- **The local stack cannot reproduce it.** Kong adds CORS there, so a preflight
  from any origin gets `200` with `Access-Control-Allow-Origin: *` whether or not
  the function has a CORS branch — verified, it answers `*` even for an origin
  that is not in the function's list. Verify this class of fix against
  `--linked`, never `--local`.

Note that a browser only ever reports the **first** thing it finds wrong. Fixing
the origin check without fixing the header list does not look like a fix; it
looks like the same error with a different sentence. Read the whole message.

There are **two error shapes** to read on the client, and conflating them is how
an expired session ends up reported as "something went wrong":

| Source | Body | When |
|---|---|---|
| Gateway, before the function runs | `{"code":"UNAUTHORIZED_…","message":…}` | session absent, expired, or malformed |
| `create-user` itself | `{"error":"forbidden"}` etc. | the request reached the function |

`createUser` in `userService.ts` maps a body with no `code` and no `error` to
`unknown`, and a `context` that is not a `Response` at all — which is what a
blocked preflight looks like from `fetch` — to `network` rather than `unknown`.
Retry does not fix either of those, so reporting them as a generic failure sends
the admin round a loop that cannot succeed.

### Creating an account, and the deadlock it was hiding

`supabase/functions/create-user/` is the **first** of three places in the
project that touch the Admin API, and it is an Edge Function for one reason:
`auth.admin.createUser` needs the `service_role` key, which bypasses RLS and
must never be shipped to a browser. Supabase provides that key to every function
as a **default secret**, so nothing has to be pasted into the file and nothing
has to be committed. The other two are `delete-user` and `reset-password`, for
the same credential reason and nothing else.

```
browser ──invoke──▶ create-user (Edge Function)
                      │  service role: read the caller, create the user,
                      │  raise must_change_password
                      ▼
                    auth.users ──on_auth_user_created──▶ profiles
                                                              ▲
browser ──────────── updateUserDetails + updateUserRole ────┘
         (ordinary requests, ordinary RLS, the admin's own JWT)
```

**The two steps are deliberate, and so is the split.** The function creates the
auth user and returns `{ id, email, mustChangeFlagSet }`; the browser then writes
`department` and `role` through `updateUserDetails` and `updateUserRole` like any
other edit. That is not an accident of layering. `protect_profile_role` refuses a
role change unless `is_admin()`, and `is_admin()` reads `auth.uid()` — which is
NULL for a service-role request. A function that also set the role would be
rejected by our own trigger, and the only way around it is disabling the trigger,
which is the thing the trigger is for.

The `must_change_password` flag is the **one** exception to the split, and it is
the exception precisely because that reasoning is column-specific. No trigger
guards that column, so the service role can write it — see The temporary password
is a prompt, not a boundary.

The function also confirms the email itself (`email_confirm: true`). This project
has no working mail provider, so a confirmation email is a link that never
arrives, and the account is created by an admin who is present for it anyway.

It verifies the caller is an admin **using the service role on purpose** —
RLS on `profiles` would otherwise answer from `profiles_select_own_or_admin`, and
the check that enforces the endpoint must not be the one RLS can influence.

#### The deadlock this removed

A project with one admin cannot hand over. `guard_last_admin` refuses the
demote, and `guard_last_admin` is right to. But there was no way to create a
second admin either, so "promote somebody else first" was advice that could not
be followed: the lockout was total, not partial.

That was a design error, not a missing feature. The "Add user" button was
rendered `disabled` with a tooltip explaining the missing Admin API, which read
as honest while leaving a fresh project permanently stuck. A guard that cannot be
escaped is only correct if the escape hatch exists. Now the create flow is the
hatch, and the last-admin tooltip says so when there is nobody to promote.

The role default in the create form is **admin**, not staff, for the same
reason: a second account created as staff would leave the project one admin
short of a handover, and the fix is a three-statement SQL procedure.

Verified end to end on the local stack, against real GoTrue sessions rather than
a forged token: a staff call returns `403 forbidden`; a missing name, a short
password and a malformed address each return their own code; a duplicate returns
`already_exists`; a good call creates an account that can sign in immediately,
with `profiles.full_name` copied from metadata by the trigger and the email
copied by `handle_new_user`; and once a second admin exists the original
self-demote succeeds, which is the handover the guard was protecting.

`tsconfig.app.json` excludes `supabase/` because the broad `**/*.ts` include —
there so `vite.config.ts` is covered — also reaches `supabase/functions/`, and
those run on Deno's edge runtime where neither `Deno` nor `npm:` specifiers
exist. Nothing in `src` imports a function, so excluding the directory keeps
`npm run build` type-checking the app honestly.

### Resetting a password, and why email could not carry it

`supabase/functions/reset-password/` is the third Admin API caller, for the
same credential reason as the other two: `auth.admin.updateUserById` needs
`service_role`, and GoTrue keeps passwords in `auth.users`, which PostgREST
cannot reach from a browser at all. There is no `profiles` column that could
substitute.

**It exists because the app's own reset flow does not work.** `/reset-password`
calls `resetPasswordForEmail`, and `[auth.email.smtp]` is still commented out in
`supabase/config.toml` — this project has no mail provider. So GoTrue accepts the
request, reports `error: null`, and the mail never arrives. That is the same trap
as `redirectTo` being silently dropped: a delivery that is not going to happen is
indistinguishable from one that is. Before this function, a user who had forgotten
their password had exactly one working way back in, and it was to delete the
account and recreate it — which took their loan history with it.

**Two guards that `delete-user` has, and this deliberately does not.** There is no
`self_delete` and no `last_admin`, and the asymmetry is the design:

- Deleting yourself strands the session on an auth user that no longer exists, so
  it must be refused. Replacing a password does not — the session survives it.
  Refusing would also remove the only recovery path for a project whose single
  administrator has lost the password, which is the case needing this most.
- A `last_admin` rule keyed on how many admins the *project* has is the exact bug
  `delete-user` documents: it looks like caution, and it makes every **staff**
  account unrecoverable in a fresh project. A password reset does not change the
  admin count, so there is nothing to guard. The `ResetPasswordErrorCode` union
  states both absences so a reader does not assume they were forgotten.

`email_confirm` is deliberately not touched. This endpoint changes a credential,
not an address, and re-confirming an account nobody asked about would change who
can sign in.

**`must_change_password` is raised here, immediately after the credential**, for
the two reasons `create-user` gives — no trigger guards that column, and a
client-side step is skippable by exactly the dropped request that makes people
reach for a retry. A password that changed while the flag write was lost is one
the administrator keeps forever with nobody asked to replace it. The flag failure
is therefore **reported** as `mustChangeFlagSet: false` and shown as a warning
above the list, not thrown: the credential did change, so an error status would
be a lie about it.

**It is not one transaction, and the wording matters.** The credential goes
through GoTrue's Admin API and the flag through PostgREST, so they are two HTTP
calls with no atomicity between them. The flag write is the second one on
purpose: a lost flag write leaves a working password the admin knows, which is
recoverable, whereas a lost credential write with a set flag would tell the user
to change a password they never received. The `mustChangeFlagSet` field is the
only honest way to report the gap.

**Known gap, not handled: existing sessions survive.** GoTrue's admin update does
not revoke a session that is already signed in, so a staff member who forgot
their password on one machine may still be signed in on another. There is no
clean one-call admin API for revoking all of a user's sessions, and the
alternatives are worse — `deleteUser` destroys the account, and deleting the
refresh tokens by hand needs a table this project does not have. Treat it as a
known limitation, not as something the endpoint did.

**There is no audit log anywhere in this project.** An admin-driven password
reset is the highest-trust action in the app and currently leaves no record of
who did it to whom.

**Verified end to end**, 17 assertions against real GoTrue sessions on the local
stack via `supabase functions serve`: a malformed id, a short password, a missing
password and an unknown id each return their own code; a staff caller gets
`forbidden`; `GET` gets `method_not_allowed`; a reset leaves the old password
dead and the new one working; a self-reset is allowed; and
`profiles.must_change_password` is `true` afterwards on exactly the reset rows and
not on the untouched ones. The credential change and the flag are the two writes
the run proves are observable, not the atomicity it disproves.

The CORS half was verified against **`--linked`, because the local stack cannot
reproduce it**: a preflight to the deployed function returns `204` with
`Access-Control-Allow-Origin: *` and all eight headers, including
`x-client-info`. The function is deployed (`reset-password`, version 1,
`ACTIVE`) — a client sees `errors.create.not_configured` until it is, and that is
the only thing standing between the screen and a working reset.

### Changing a role needs no new policy

`profiles_select_own_or_admin` already gives an admin every row, and
`profiles_update_own` already lets an admin write any row. `protect_profile_role`
already restricts the change to admins. So `getAllUsers`, `updateUserRole` and
`updateUserDetails` in `src/modules/users/services/userService.ts` work on the
existing policies — the whole module adds no migration.

### Two guards the screen depends on

Both are in `20260927000700_user_management_guards.sql`, both triggers rather
than client checks, because hiding a control does not stop anyone with a session
from sending the request.

1. **`guard_last_admin`** — `before update of role`, refuses a demote that would
   leave no admin, with `23514` and the message `Cannot remove the last admin`.
   Without it an admin removes their own admin role in one statement and the
   project is locked; recovery is the manual three-statement procedure in
   Promoting the first admin. The screen also disables the control when it
   counts one admin, and `isLastAdminError` in the service layer handles the race
   where a second admin demoted themselves in between — but the trigger is what
   actually holds.

   It takes `pg_advisory_xact_lock` before checking, and that is load-bearing.
   A plain `not exists` reads a snapshot taken before the other transaction
   committed, so two admins demoting each other at the same moment would each
   see the other still an admin and both would pass. The lock serialises them.
   It is an advisory lock rather than `lock table` because the `update` already
   holds a ROW EXCLUSIVE lock on `profiles`, and a `before update` trigger asking
   for a conflicting table lock deadlocks its own transaction.

2. **`protect_profile_email`** — `before update of email`, refuses the write with
   `42501` unless the caller is an admin. `profiles_update_own` lets a user
   write their own row, and a policy cannot restrict *which* columns get written,
   so the same reasoning as `protect_profile_role` applies. Without it the new
   `profiles.email` would be free for any signed-in user to overwrite on their
   own row and the address in the admin list would be whatever they typed.

### `profiles.email` is a denormalisation

The email lives in `auth.users`, which PostgREST does not expose, so
`20260927000600_profiles_email.sql` copies it onto `profiles` and the unique
index asserts what `auth.users` already guarantees. Sign-in and the password
reset still read `auth.users`; the column is display data for the list and its
search, and nothing else.

It can go stale: an address changed by hand in Auth will not appear here until
the backfill `update` is re-run, and that re-run is **blocked** by
`profiles_protect_email` unless the caller is an admin, for the same reason
`profiles_protect_role` is — `is_admin()` reads `auth.uid()`, which is NULL for
`postgres`. The repair is the same three-statement dance, with
`profiles_protect_email` instead of `profiles_protect_role`. This is the one
place where `00600` is not safe to re-run as written.

An admin can still correct the column through the app, which is why
`protect_profile_email` tests `is_admin()` rather than refusing everyone.

### The self-demotion trap, and `refreshProfile`

`AuthContext` fetches the profile once per `userId` and caches it. Change your
own role on the screen and that row is stale, so `useIsAdmin()` keeps reporting
admin and the admin-only page keeps rendering until a reload. `refreshProfile`
on the context exists for exactly this; the effect alone cannot help, because
`userId` does not change. The screen calls it when the changed row is the
signed-in user's own.

The related trap is quieter: a **non**-admin's rejected write is not an error.
`profiles_update_own` filters the rows a caller may touch, so a staff member
promoting somebody else matches **zero rows** and PostgREST reports success.
Verified locally. Do not treat a resolved `updateUserRole` as proof it
happened — a `.select()` would return an empty array instead.

### Trigger functions and `search_path`

`handle_new_user`, `is_admin`, and `protect_profile_role` are `security definer`
and all pin `set search_path = public`. The pinning is not decoration: without
it, a caller who can create a schema earlier in the search path can shadow
`insert` or `auth.uid()` and redirect the function.

`is_admin()` is `security definer` **so it can read `profiles` without re-entering
RLS** — the `profiles` policies call it, so a non-definer version would recurse
infinitely. It is `stable` and its result is an `exists` on an indexed `id`
lookup, so policies can use it freely.

### Signup never assigns admin — the first admin is promoted by hand

`handle_new_user` creates every profile as `staff`. There is no first-user
bootstrap: whoever signs up first gets `staff`, exactly like everyone after them,
even if they put `"role": "admin"` in their signup metadata.

That used to be the other way round, and it was a real exposure rather than a
theoretical one. As of this writing the remote project had **0 users and email
signup enabled**, so the grant was sitting there unclaimed and the first person to
reach the signup endpoint would have owned the database.
`20260927000400` removed it. The app's `/signup` route is gone as well — see
There is no signup route.

`role` is **never** read from `raw_user_meta_data` in any case. Signup accepts an
arbitrary `options.data` object from an anonymous caller, so trusting it would be
a privilege-escalation hole regardless of the grant.

**This means a fresh project has no admin and is read-only until you promote
one.** That is deliberate, and the deadlock is real: `role` defaults to `staff`,
`profiles_protect_role` refuses self-service role changes, and no admin exists to
grant it. Only the *who* changed, from "first signup" to "a human, on purpose".

#### Promoting the first admin

Run these three statements from the repo root, substituting the target's `id`.
All three are single statements on purpose — `supabase db query` cannot send
several at once, and needs no `service_role` key, no `psql`, and no extra package.

```bash
# 1. the target's id — from the dashboard, or:
npx supabase db query --linked -f q.sql   # select id, email, role from auth.users join public.profiles using (id);

npx supabase db query --linked -f p.sql   # alter table public.profiles disable trigger profiles_protect_role;
npx supabase db query --linked -f p.sql   # update public.profiles set role = 'admin' where id = '<uuid>';
npx supabase db query --linked -f p.sql   # alter table public.profiles enable trigger profiles_protect_role;
```

`db query` connects as `postgres`, which has `bypassrls`, so **RLS is not what
blocks you** — `profiles_protect_role` is. The trigger calls `is_admin()`, which
reads `auth.uid()`, which is NULL without a JWT. Verified: a bare `UPDATE` fails
with `42501 Only an admin may change the role column`. That is why step 1 exists,
and why steps 1 and 3 must not be skipped.

Re-enabling the trigger is not optional housekeeping. Leaving it disabled would
turn off the one protection against self-service privilege escalation, which is
the thing this whole arrangement exists to provide.

Verified end to end on the local stack after 004: first signup gets `staff` even
while claiming `"role":"admin"`; the promote sequence produces a working admin
(HTTP 201 on an admin-only insert); staff still get `403` on the same insert and
`403` on self-promotion; and staff keep read access.

Do not re-add a first-user grant to make onboarding easier. If self-service
onboarding is genuinely needed, gate it on an allowlisted address — a hardcoded
email in a migration is a smaller mistake than an unclaimed admin grant.

## The temporary password is a prompt, not a boundary

`profiles.must_change_password` is the third piece of the create flow, and the
only one where the honest answer is "this does not do what it looks like it
does".

The create flow has an admin either type a password or generate one with
`generatePassword` in `src/lib/password.ts` — a CSPRNG draw, 20 characters from a
69-symbol alphabet with the ambiguous `0`/`O`/`1`/`l`/`I` removed and one
character guaranteed per class. Either way **the admin knows the first
credential**, and will keep knowing it for as long as nobody changes it. The
column is how the app knows to ask, once, on the new user's first sign-in.

**Nothing on the server can enforce it.** GoTrue has no `mustChangePassword`
equivalent to the one Windows AD and LDAP carry, so the temporary credential
keeps working and someone determined to keep it simply can. What the flag buys
is that the admin's knowledge stops being permanent the first time the user
signs in. The honest version of this feature is an emailed reset link, where the
admin never sees the password at all — that needs a working mail provider, which
this project does not have. `default false` is what keeps the accounts already
in production unaffected.

**No trigger guards this column, and none should.** It is a prompt to the
account holder, not a privilege decision, so `protect_profile_email` and
`protect_profile_role` have nothing to say about it. That is also why an admin
*could* clear it for someone else from the browser, and the only reason the list
shows the flag as a read-only badge rather than a button is that a button there
would look security-shaped while only writing a boolean. Clearing it belongs to
the account holder.

### It is raised in the Edge Function, and that is the exception

Every other post-creation write happens in the browser, because
`protect_profile_role` refuses them from a service-role request. This one does
not, for two reasons that both point the same way:

1. **No guard blocks it.** The two-step split exists *because* of the column
   guards. `must_change_password` has none, so the reason for the split does not
   apply. Verified on the local stack: from a context with `bypassrls` and a NULL
   `auth.uid()` — exactly the service role's position — the flag write succeeds
   while a `role` change on the same row in the same transaction is refused with
   `42501`. That contrast is the justification; if it ever stops holding, this
   needs revisiting.
2. **A client-side step is skippable** by exactly the dropped request that makes
   people reach for retry, and this is the one write that must not be skipped.

`create-user` therefore returns `{ id, email, mustChangeFlagSet }`. The third
field is **not** swallowed by the browser, because `false` means the account
exists, still carries the admin's password, and nothing is going to ask for a
change — which is unrecoverable from that screen. It surfaces as a dismissible
warning above the list. It is reported rather than thrown on the function side
too: the account exists by then, so an error status would be a lie and a client
retry would only meet `already_exists`.

Deploying the function is a prerequisite for this working, and
`t("errors.create.not_configured")` already covers the case where it is not.
A function predating this returns neither `mustChangeFlagSet` nor anything else
new, which is why the client defaults it to `false` — claiming the user will be
asked to change a password nothing is going to ask them for would be the worse
lie.

### The gate is a wrapper, not a route

`src/components/auth/MustChangePassword.tsx` wraps the `<Outlet />` inside
`RequireAuth` rather than being registered in `App.tsx`. A route is reachable
around: type `/calendar` and the prompt is never shown. Wrapping the outlet means
one check covers every protected screen, with no new route and no way to
navigate past it.

It **fails open**, which is the opposite of `useIsAdmin` and deliberate. There the
unknown case is "the profile has not arrived", and closing is right because the
action being hidden is a write. Here the unknown case is "the profile row could
not be read", and blocking on it would lock a working account out of the one
screen that could fix whatever broke. So it gates only on a positively known
`true`. It also holds the app while `isProfileLoading`, which costs one
round-trip that `useIsAdmin` was already making, and buys the absence of a flash
of dashboard immediately followed by a full-screen takeover.

On success it calls `refreshProfile`, not just `completePasswordChange`. The
cached row still says `true` and `userId` did not change, so nothing else would
re-read it — the gate would sit there forever over a password already changed.
That is the same stale-cache trap as the self-demotion, with the same fix.

### Testing RLS

`db query --local` against the local stack is the fast loop: no network, no rate
limits, and `db reset --local` restores a known-empty database in seconds. Use
`--local` for anything that does not need to prove anything about production.

Impersonate the `authenticated` role by setting a fabricated JWT, inside a
transaction that ends in `rollback`:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
-- assertions here
rollback;
```

`set local` scopes both to the transaction, so `rollback` leaves no residue. The
database was verified empty afterwards.

To create the two fixtures this needs, insert a user into `auth.users` and let the
signup trigger build the profile — that also exercises the trigger rather than
bypassing it. Note that a local `auth.users` insert needs the columns the trigger
reads (`raw_user_meta_data`, `id`, `email`) and nothing else.

Run the same assertions twice, once against `--local` and once against
`--linked`. A policy that behaves differently in the two is a policy depending on
something local, which is itself the bug.

## Conventions

- Component files are PascalCase with a default export. Hook files are camelCase.
  `date-picker.tsx` is a deliberate exception; leave it.
- New reusable component → `src/components/<feature>/` if domain-specific,
  otherwise `src/components/common/` or `src/components/ui/`.
- New icon → drop the `.svg` in `src/icons/` and add a named export to
  `src/icons/index.ts`. **Never inline SVG markup** in a component.
- Every page renders `<PageMeta title="…" description="…" />` first, and
  `<PageBreadcrumb pageTitle="…" />` at the top of admin pages.
- Demo sections are wrapped in `<ComponentCard title="…">`.
- Every `<Label htmlFor>` must name an id that actually exists in the rendered
  output. `Select` and `MultiSelect` only have one if you pass `id`, so passing it
  is part of using them, not an extra. A label pointing at nothing is a React
  console warning, a screen reader announcing an unlabelled control, and a
  browser that skips the field for autofill.
- Modals use the `useModal` hook plus the `<Modal>` primitive.
- Global state goes through the existing `useAuth`, `useSidebar`, `useTheme`,
  and `useLanguage` contexts. Do not add a provider without a clear need.
- Supabase-facing helpers go in `src/lib/`, not in `context/`. A context holds
  React state; a client instance holds no state at all.
- Context methods **throw** on failure rather than returning an error object, so
  call sites need `try` / `catch` / `finally`. `src/lib/authErrors.ts` turns the
  thrown `AuthError` into an i18n key — do not surface `error.message` raw.
- Supabase error `code` strings are mapped in `authErrors.ts`. Unknown codes fall
  back to `errors.unknown` deliberately, so a new Supabase code shows a generic
  message rather than leaking internals.

- i18next is bootstrapped once in `src/i18n/index.ts`, imported by `src/main.tsx`.
  Never re-initialise it.
- One namespace, `"common"`. One locale, `en`. The file is
  `src/locales/en/common.json` — add new keys there. It holds 480 leaf keys
  today, under `sidebar`, `header`, `userDropdown`, `auth`, `profile`,
  `mustChangePassword`, `departments`, `assetSettings`, `users`, and `assets`.
- **Do not repeat a key inside one object.** JSON resolves a duplicate by taking
  the last one, silently, and `require()` will not complain. `users.fields` and
  `users.emailManagedElsewhere` both existed twice for a while; the two copies
  happened to agree, which is the only reason it was harmless. JSON is outside
  the prettier glob below, so nothing else will ever flag it.
- Read keys with `useTranslation()`. Scope to a subtree with `keyPrefix`:

  ```tsx
  const { t } = useTranslation("common", { keyPrefix: "header" });
  t("searchPlaceholder");
  ```

- **Never pass a key path as the namespace argument.** `useTranslation("header")`
  compiles, does not throw, and silently renders raw key names, because nothing
  is registered under a `header` namespace and `fallbackNS` is not set. This is
  not hypothetical — it shipped in `AppHeader` until it was fixed.
- `src/i18n/languages.ts` holds the language registry. `LanguageContext` syncs
  i18next, `localStorage`, and `<html lang>` / `dir`.
- Interpolation delimiters are `{` and `}`, not the i18next default — so a
  placeholder in `common.json` is written `{name}`, **not** `{{name}}`.
  `{{name}}` is not a near-miss that renders slightly wrong: with a single-brace
  prefix and suffix, i18next does not recognise it at all and returns the
  literal `{{name}}` to the screen. Every interpolated key in this file shipped
  that way at first, including `users.confirmBody` and `users.showing`, and the
  symptom reads as a missing translation rather than a delimiter mismatch.
- Only `en` is enabled. If you add a locale, add a matching
  `src/locales/<code>/common.json` **and** register it in `languages.ts`. There is
  no RTL locale, so the `dir` plumbing is untested.
- Do not add a key without a caller. Dead keys accumulate silently.

## Styling

- Tailwind v4 only. The theme lives in `src/index.css` under `@theme` (133 tokens).
- Prefer theme tokens over literals: `brand-*`, `gray-*`, `blue-light`, `orange`,
  `success`, `error`, `warning` (scales `25`–`950`), `font-outfit`,
  `text-theme-*`, `text-title-*`, `shadow-theme-*`, and the `2xsm` / `xsm` / `3xl`
  breakpoints.
- Dark mode is class-based via `@custom-variant dark (&:is(.dark *))`. `ThemeContext`
  puts `.dark` on `<html>`. **Every styled element needs a `dark:` variant.**
- Prefer CSS logical properties for RTL readiness: `ms-*` / `me-*` over `ml-*` / `mr-*`,
  `ps-*` / `pe-*` over `pl-*` / `pr-*`, `start-*` / `end-*` over `left-*` / `right-*`,
  `border-s-*` / `border-e-*`, `rounded-s-*` / `rounded-e-*`, `text-start` / `text-end`.
  Flip directional icons with `rtl:rotate-180` or `rtl:-scale-x-100`.
- Reuse the `@utility` classes in `index.css` (`menu-item`, `menu-item-active`,
  `menu-item-inactive`, `menu-item-icon`, `menu-dropdown-item`, `no-scrollbar`,
  `custom-scrollbar`, …) before adding new ones. Tailwind only emits utilities it
  sees used, so an unused one costs nothing.
- Third-party CSS overrides live at the bottom of `index.css`, using `@apply`.

## Decisions to preserve

These were deliberate. Do not "clean them up" without asking.

| Decision | Why |
|---|---|
| `assets.status` is kept in step with the loans by triggers, not by client code | The owner chose the complete fix over the cheap one (#40). A trigger on `assignments` alone leaves `assets.status` directly writable and the contradiction one statement away, so the guard on `assets` is the half that makes the column trustworthy. Same reasoning that already put `set_updated_at` and the maintenance guards in the database |
| Device credentials live in `asset_credentials`, not on `assets`, and stay plaintext | The split is not optional — a policy filters rows, not columns, so two columns on a table every user can read would put a device password in every staff member's list response. Splitting is the only lever RLS gives. The plaintext part is a known gap, not a preference: the honest fix is `bytea` plus an Edge Function holding the key, and no such key exists here. The form says so and recommends a password manager instead |
| `usage_status` is a column, but not a rename of `status` | The workbook is the specification and `Usage Status` is one of its headings, so refusing it twice was not a decision the owner could keep making. It is still a **separate column**, the triggers never read it, and the overlap with `assigned` is stated on the form. See The workbook is the specification |
| `device_condition` is still not added | `assets.condition` already holds that column, constrained to five values. `01200` added `usage_status` and deliberately did not add this one, because it genuinely is a duplicate rather than a new fact |
| Sub-category is `categories.parent_id`, not a column on `assets` | A self-reference gives the second level without a second free-text column on every row, and `on delete set null` promotes the children instead of deleting assets |
| The asset delete is guarded, not hard and not soft | Both foreign keys cascade, so a hard delete takes loan and service history — the same loss the user-delete warning spells out. A guard is cheap here in a way it was not for users: an asset with no history is safe to remove, one with history is worth keeping. Soft delete was rejected because it adds a `status` value the two status guards would then have to be taught about |
| Reference data is `categories` and `locations`, not `asset_*` copies | The issue asked for `asset_categories`, `asset_sub_categories` and `asset_locations`; all three already existed under the existing names and `assets.category_id` / `assets.location_id` already reference them. A parallel set would be a second source of truth for two facts the database owns. `asset_sub_categories` is `categories WHERE parent_id IS NOT NULL`, not a table |
| `locations.room_name` is nullable, and `name` is dropped | An area is a legitimate value on its own, and a `not null` room forces "N/A" — a null written as a string. `name` is dropped rather than kept beside the pair, so the two cannot disagree with nothing saying which is right. The display string is assembled client-side, because a picker wants one line and the database should hold the two facts |
| The category delete is refused by a trigger *and* by the app | `assets.category_id` is `on delete set null`, so the database would silently un-assign every asset in the category. `categories_guard_delete` holds for any caller; `deleteCategory` also asks, so the admin is told the counts rather than just getting a refusal code. Same pattern as `DepartmentInUseError` |
| Writes on both reference tables are admin-only | The issue asked for "read & write for authenticated". Staff read them because the asset form's pickers need the data, but a staff write could re-point every asset in a category. Matches `assets_write_admin` and the existing policies |
| `NavSubItem` has `adminOnly` and the sidebar filters it | The Asset Management group mixes an open-to-everyone screen (the inventory) with an admin-only one, so the flag cannot live on the group. A group whose every sub-item is admin-only is dropped entirely rather than rendered as a dead row for staff. The emptiness test is "does it still have any sub-items", **not** "is it adminOnly" — the latter also drops admin-only groups for an admin, which is how User Management went missing the first time this was written |
| `categories.department` is the owning unit, and uniqueness is per unit | A unit filter needs a category's identity to be its name *within its unit*; the global `UNIQUE (name)` is what stopped HSSE having a `Monitor` while IT had one. Two partial unique indexes replace it, and the two guards keep a child from being filed under a parent in another unit |
| `assets.department` is derived from the category, never written by the client | It exists so the list can filter by unit without a join. `assets_sync_department` overwrites rather than raising, because a client cannot tell "the column was not sent" from "the default was sent", and an honest insert that omitted it would otherwise be refused. The trigger is on `update of category_id, department` — both, because an `UPDATE OF` list only fires for a column actually in the SET list |
| The four HSSE fields are typed columns, not a `jsonb specifications` blob | Their types are already known, so a free-form column would accept `"31/12/2026"` beside a real date with nothing to object, and would make "expire within 30 days" unindexable. Verified: a non-date `expiration_date` is refused |
| `next_inspection_date` is stored, not derived from the last one | The interval between inspections is a policy, not a fact, and policies change without a migration being the right place to record it |
| `status` is not a field on the asset form, and `assigned` is offered nowhere in the module | `available` and `assigned` are derived from the loans and `assets_guard_status` refuses a contradicting write, so a form offering either would offer something the database rejects. `setAssetStatus` takes `Exclude<AssetStatus, "assigned">` so the un-derivable value cannot even be passed |
| The asset list is readable by every signed-in user, unlike `/users` | Stock belongs to the company rather than one department, and `assets_select_authenticated` is `using (true)`, so gating the read hands every staff member an empty page. Staff lose the Credentials tab and the write actions, and the credential was never in their response |
| The form switches on `categories.code`, not on the category name | A name is editable, so a rename would silently empty a fieldset. `code` is nullable and unique, survives a rename, and a category without one falls back to the common fields instead of breaking the form. See The form switches on a category code |
| The switch is on the *main* category, and an asset with no sub-category stores the parent directly | `parent_id is null` is what makes a row a parent. Sub-category only refines the label, so `toInput` sends `category_id \|\| parent_category_id` and a new main category clears the child. One column, two possible meanings resolved by one rule, instead of a second nullable column |
| Ports are ten `port_* integer` columns, not a `text[]` of names | `01100` stored port *names* for a checkbox; the workbook stores *counts* in one column per port (`HDMI = 3`). Keeping the array would leave two competing models for one fact — a row could say `input_ports = '{HDMI}'` and `port_hdmi = 1` with nothing to say which is right |
| `protocol_url` stays on `assets` even though that exposes it to every staff member | The owner chose warning over a credentials-shaped table and over moving the column. A URL embedding `user:pass` is readable by all signed-in users, which the form says out loud and the column comment repeats — the alternative would be a per-category secret table holding a field that is not really a secret |
| `current_location` is a free-text column that is allowed to diverge from `location_id` | Accepted knowingly, not overlooked: a physical room or desk changes faster than a picker can be kept current, and nothing keeps the two in step. Unlike a `status` contradiction this is not enforced, so the fix, if it ever is needed, is a transition rule and an audit trail rather than a second text column |
| No first-signup admin grant; the first admin is promoted by hand | The owner chose to close it (#39) over keeping it for convenience. The remote had 0 users with signup open, so the grant was an unclaimed admin for anyone who found the URL. The cost is a fresh project starts read-only — see Promoting the first admin |
| `@supabase/supabase-js` is the backend, wired for email/password auth | Requested by the project owner. It costs ~760 kB of extra JavaScript, most of it realtime/PostgREST/storage this app does not use yet, but the owner wants this client |
| The social sign-in buttons are removed, not `disabled` | They were `disabled` placeholders and the owner reversed the earlier decision to keep them visible. The "or" divider went with them, because its only purpose was to separate two ways in — leaving it above a form with no alternative reads as a bug. `google.svg` and `x.svg` are still in `src/icons/` and still exported, unreferenced, in case OAuth is picked up again |
| `google.svg` keeps its brand hexes instead of theme tokens | The Google logo is genuinely multi-colour — `#4285F4`, `#34A853`, `#FBBC05`, `#EB4335` are what makes it the Google logo. Recolouring it with a token would stop it being the logo at all, so the "no hardcoded hex" rule has a documented exception here and only here. Unreferenced since the social buttons were removed, but kept for the same reason. `x.svg` is monochrome and uses `currentColor` |
| `src/components/calendar/*` stays | The one genuinely original feature, not template code. Not asset-management related, but it proves the repo has its own work in it |
| i18n stays | The sidebar, header, and user dropdown are already translated |
| Auth pages stay | The form markup and validation shape were sound. The submit handlers were replaced with real Supabase calls; the surrounding markup is unchanged |
| `/reset-password` is outside both route guards | A recovery link creates a session on arrival, so any redirect guard fights the flow. See Routing |
| The 13 primitives stay | They are the component library. Deleting them for lack of consumers throws away working UI |
| `/signin` is not in the sidebar | Intentional. The auth shell is reachable by URL so it stays out of the way of domain navigation |
| The signup form is removed rather than hidden | The owner chose invite-only: an admin creates users, nobody self-registers. The form's route, component, context method and 27 i18n keys all went with it — see There is no signup route |
| `vercel.json` holds only the SPA rewrite | Deep links 404 on a hard load without it, and that only shows up on refresh and bookmarks. Framework, build command and output directory stay on Vercel so the two cannot drift apart |
| The "Asset Management" sidebar row opens an "Asset IT" submenu | It was a `disabled` placeholder marking where domain navigation would go, and a `disabled` row cannot dead-link to a 404. It now follows the same shape as User Management: a group whose submenu opens from the active route |
| `src/modules/<feature>/` for features that bring a page plus a service layer | A standalone page under `src/pages/` has nowhere to put its own service code. The route still lives in `App.tsx`; the module owns only the files below it. `src/modules/users/` is the precedent |
| Modules are `.ts` / `.tsx`, never `.js` / `.jsx` | The spec for user management asked for `.js`/`.jsx`. `allowJs` is absent (so false) and `include` is `["src", "**/*.ts"]`, so a `.jsx` never enters the TypeScript program and a `.tsx` importing one fails `tsc -b`. Same files, correct extension |
| User management's delete is a hard delete, behind a warning | It needs `supabase.auth.admin`, so a `service_role` key, which is in Don'ts — hence a second Edge Function. The owner chose hard delete over a deactivation flag, and the modal spells out the cascade rather than saying "this cannot be undone", because losing loan history is the actual consequence. See Why a hard delete cannot rely on the cascade |
| Creating a user is two steps, not one | The Edge Function does the privileged half; the browser does the role and department over normal RLS. `protect_profile_role` refuses a role change from a service-role request, because `is_admin()` reads `auth.uid()` and that is NULL without a JWT. Doing it in one step would mean disabling the trigger, which is the point of the trigger |
| The `must_change_password` flag is set in the function, not the browser | It is the one column on the new row that no trigger guards, so the reason the create flow is split in two does not apply to it. Verified: a service-role write of that column succeeds where a `role` change in the same transaction is refused with 42501. It is also the one write that must not be skippable, and a client-side step is skippable by exactly the dropped request that makes people retry |
| `must_change_password` has no trigger, and is a read-only badge rather than a button | It is a prompt to the account holder, not a privilege decision, so the column guards have nothing to say about it. An admin *can* clear it from the browser; the reason no button is offered is that it would look security-shaped while only writing a boolean. Clearing it belongs to the account holder |
| The password gate wraps `<Outlet />` instead of being a route | A route is reachable around — type `/calendar` and the prompt never appears. One check inside `RequireAuth` covers every protected screen, with no new entry in `App.tsx` and nothing to navigate past |
| The last-admin rule is a trigger, not a button's `disabled` | The one-statement lockout was demonstrated locally before the fix, and hiding a control does not stop anyone with a session from sending the request. Same reasoning as `protect_profile_role` and `assets_guard_status` |
| `profiles.email` is a copy of `auth.users.email` | The user list has to show and search by email, and `auth.users` is not reachable from PostgREST. A `service_role` key is the only alternative and it is forbidden. Sign-in and password reset still read `auth.users`, so the copy is display data only |
| Name and role are separate controls, not one form | The details write is safe precisely because it sends only two columns, and `role` in the payload would stop being safe. Two modals keeps the "only two columns" property in the code instead of relying on the form to be careful |

## Known rough edges

Real, verified, and left alone on purpose. Fix them if you touch the area, but do
not go looking for them unprompted.

- Identity-based resets assume a stable key from the caller.
  `CalendarEventModal` remounts its form on `selectedEvent.id`, and every event
  does carry an `id`. `AppSidebar` scopes its manual submenu toggle to
  `location.pathname`. Both would misbehave if a caller passed unstable identity.
- `updateOwnProfile` in `src/lib/profiles.ts` has no caller. `MustChangePassword`
  uses `completePasswordChange`, not this one, and the `/profile` page is still
  read-only. The function is sound and correct — it sends the same two columns
  `updateUserDetails` does, for the same trigger reason — it is just waiting on
  the edit form that would resolve the next item.
- `UserDropdown` is now role-aware, and that resolved the three-labels-one-page
  problem. Support is not a page at all: it is an external `wa.me` link to the IT
  help desk carrying a prefilled message — name, role, department, then an empty
  `Details:` line for the person to continue typing in WhatsApp. `Account
  settings` is admin-only, because for a staff member it resolved to the same
  read-only `/profile` as the item above it, which is a promise the app cannot
  keep. The remaining item is relabelled `Profile detail` for staff, since
  "Edit profile" overpromises on a page nothing can be edited on. Two of the
  labels still mean "look at your own row", so the honest fix is still to build
  the edit capability and collapse them.
- `DropdownItem` takes `href` as well as `to`, and they are not
  interchangeable. `to` renders a react-router `Link`, which intercepts the click
  and routes inside the SPA, so an external URL sent through it navigates instead
  of opening. `rel="noreferrer"` is there because `target="_blank"` without it
  hands a third-party page a `window.opener` reference back to this one.
- A `wa.me` number must be international and bare: no `+`, no spaces, no leading
  zero. `081180119800` is `6281180119800`; the local form opens a chat to a
  number that does not exist and reports no error.
- `useIsAdmin()` now has two kinds of caller: the role badge on `/profile`, and
  `/users`, which refuses to render at all for a non-admin and hides its
  admin-only row actions behind the same hook. That is the end-to-end
  demonstration the badge never was — but the *enforcement* still lives in
  `profiles_select_own_or_admin`, `profiles_update_own` and
  `profiles_guard_last_admin`, not in either caller.
- `AuthContext` sets `isLoading` to `false` from inside the `onAuthStateChange`
  callback rather than from a separate `getSession()` call. That is deliberate —
  see Supabase. It does mean `isLoading` is `true` for one extra microtask.
- `AuthContext.signOut` can reject, and `UserDropdown.handleSignOut` catches it so
  it cannot become an unhandled rejection, but the failure still only reaches
  `console.error`. The dropdown is already closed, `navigate` is skipped, and the
  user stays signed in, so the direction is safe — but nothing *tells* them the
  sign-out did not happen. There is no toast primitive in the repo, so closing
  that gap means adding one, which is a larger decision than this catch.

## Don'ts

- Don't install packages without asking. Every dependency here was either needed
  by a surviving feature or kept by explicit owner decision.
- Don't create a `tailwind.config` file.
- Don't add routes outside `src/App.tsx` or pages outside `src/pages/`.
- Don't add demo or example pages. They were removed on purpose.
- Don't add demo image assets. `public/images/` holds 13 files and exactly one of
  them, `logo/auth-logo.svg`, is no longer referenced — the login page now uses
  `logo/logo-pgt.png`. The template's white AdminTail mark was designed for the
  `bg-brand-950` auth panel, and the PGT wordmark is dark navy, so it needed a
  white plate behind it to be legible in light mode. `auth-logo.svg` is kept
  rather than deleted for the same reason `google.svg` is.
- Don't delete a primitive because reachability tooling reports it as an orphan.
  See the 13-primitives section.
- Don't hardcode user-facing text in the shell — add a key to
  `src/locales/en/common.json` and use `t()`. Note that page-level content in
  `Dashboard.tsx` and `Blank.tsx` is currently hardcoded English, so the rule is
  inconsistently applied; be consistent within the file you touch.
- Don't pass a key path as the i18next namespace argument.
- **Don't render a `TableCell` without padding.** The primitive is a bare `<td>`
  with no padding of its own — `cn(className)` and nothing else — so a cell with
  no `className` puts its text flush against the card border and the row has no
  separator. Every cell in `AssetListPage` carries explicit `px-* py-*`, and the
  row carries `border-b`; copy that. Two related traps in the same primitive:
  `TableCell` defaults to `<td>`, so a header cell needs `isHeader` or a `<td>`
  lands inside `<thead>` and the browser repairs the markup unpredictably; and
  `px-*` plus `ps-*` on one element resolve by **stylesheet order**, not by the
  order they are written, so write `py-3 ps-9 pe-4` rather than stacking them.
- Don't put a long sentence and a button in the same `sm:flex-row
  sm:justify-between` without `shrink-0` on the button. The text is the flexible
  element and takes the shrink, until the button's own label wraps onto two lines.
- Don't hardcode hex colors in `className`. The one exception is
  `src/icons/google.svg`, which is a multi-colour brand logo; see the Decisions
  table.
- Don't use physical directional utilities (see Styling).
- Don't inline SVG markup.
- Don't use CSS-in-JS or CSS Modules.
- Don't add a locale without adding the matching JSON file.
- Don't set state synchronously inside `useEffect`. The lint rule catches the
  obvious cases, but it does **not** see a `setState` nested inside a function
  that the effect calls. Check by reading.
- Don't call `createClient` outside `src/lib/supabase.ts`.
- Don't branch on `profile?.role` inline. Use `useIsAdmin()`, so the rule and its
  fail-closed default live in one place.
- Don't treat hiding a write action as access control. RLS is the enforcement
  point; the UI gate is only there so staff are not shown a button that cannot
  work.
- Don't commit `.env.local`, and never put a `service_role` key in any tracked
  file.
- Don't add a `self_delete` or a `last_admin` guard to `reset-password` to match
  `delete-user`. A password change neither removes an administrator nor strands
  a session, and a project-count rule is what makes every staff account
  unrecoverable in a fresh install. See Resetting a password.
- Don't move the `must_change_password` write out of `reset-password` into the
  browser. It is the same reasoning as `create-user`: the credential and the flag
  belong to one transaction, and a dropped request is the one failure the flag is
  there to cover.
- Don't report a failed flag write as a failed reset. The password already
  changed, so an error status would be a lie and a retry would meet a flag that is
  already set.
- Don't edit the three applied migrations or add `if not exists` to make them
  re-runnable. New schema goes in a new migration. See Database.
- Don't run `supabase` CLI commands from outside the repo root. `link` is
  directory-scoped and the failure is confusing. See Database.
- Don't create a policy for `anon`. It holds no grants on purpose; the absence of
  grants is the protection.
- Don't add a table to `public` without `revoke all on … from anon` next to its
  `grant`. Supabase's default privileges already give `anon` all seven
  privileges, and with no `anon` policy every query comes back empty, so the
  mistake survives every test. See The asset inventory.
- Don't put a device password on `assets`. A policy filters rows, not columns, so
  a table every user can read cannot withhold one field. See The asset inventory.
- Don't add `usage_status` or `device_condition` to `assets`, or any fourth free
  text column that duplicates a constrained one.
- Don't put `assigned` in the asset form or in `setAssetStatus`'s type, and don't
  send `status` from `createAsset` or `updateAsset`. See The asset inventory.
- Don't hard-delete an asset from the UI, and don't add soft delete without
  teaching `assets_guard_status` and the maintenance guards the new value.
- Don't switch the asset form on `categories.name`. A name is editable, and a
  rename would silently empty a fieldset. Switch on `code`, and add a code to a
  category rather than teaching the form its name.
- Don't create a second set of reference tables as `asset_categories`,
  `asset_sub_categories` and `asset_locations`. `categories` and `locations` are
  those tables, and `assets.category_id` / `assets.location_id` already reference
  them. See Asset settings manages the reference data.
- Don't add `room_name text not null` to `locations`. An area is a legitimate
  value on its own, and a not-null room forces the field to hold "N/A", which is
  a null written as a string.
- Don't rely on a `(area_name, room_name)` unique index alone to stop two
  room-less rows for the same area: `null` is distinct from `null` in a Postgres
  unique index, and `locations_area_only_key` is the partial index that actually
  refuses the duplicate.
- Don't write `assets.department` from the client. It is derived from the category
  by `assets_sync_department`, and a value that disagrees with the category is a
  bug rather than a variant.
- Don't let a category be deleted while it still has assets or sub-categories.
  `assets.category_id` is `on delete set null`, so the database will do it and
  say nothing. `categories_guard_delete` holds; `deleteCategory` asks.
- Don't let a sub-category be filed under a parent from another unit, and don't
  move a parent between units while it still has children. Both strand rows that
  then render as orphans in the unit filter; `guard_category_parent` and
  `categories_guard_department_change` refuse them.
- Don't add a unit to `DEPARTMENTS` and forget that `categories.department` is
  free text. The column has no `check`, so a typo is accepted and the row is then
  invisible in the filter — that is the documented cost, and the list is the one
  place a unit is added.
- Don't drop `categories_name_key` with `drop index`. It is a table constraint
  from `categories.name text not null unique`, and the drop is refused with
  `2BP01`; it needs `alter table … drop constraint`.
- Don't allow a third category level, and don't put a `code` on a sub-category.
  The form resolves the main category by one hop through `parent_id`, so a third
  level silently selects the wrong fieldset.
- Don't self-embed `categories` to reach a category's own parent.
  `parent:categories!categories_parent_id_fkey` — the documented hint for that
  exact FK — fails with `PGRST200` on both the local stack and the remote,
  because a self-relationship is not matched by constraint name. The hintless
  and `!parent_id` forms do resolve, and resolve to the **inbound** direction:
  they return an empty array where the parent belongs, so the label silently
  reads as a bare sub-category. `getAssetFilterOptions` reads the table flat and
  joins `parent_id` to `id` in memory instead, which cannot pick a direction.
- Don't assume a 200 from PostgREST means the embed is right. A wrong-direction
  self-embed is a 200 with an empty array, which is why this went unnoticed while
  the explicit-hint version 400'd loudly.
- **Don't leave a `select` list naming a column a migration dropped.** This is
  the `locations.name` case: `01300` split it into `area_name` + `room_name`, the
  asset read's embed kept asking for `name`, and the failure was not a null in one
  column — PostgREST refused the *whole statement* with `42703` and the entire
  list rendered nothing. The list view is the only place a dropped column shows
  up as a total outage rather than a blank cell, so it is the reason the column
  list is explicit.
- **Don't put a comment inside the `ASSET_COLUMNS` template literal.** supabase-js
  parses that string at the type level, so a `--` line turns the whole literal into
  a `ParserError` and `tsc` fails on every `.select()` in the file with a message
  that names the comment rather than the cause. The explanation belongs in the
  doc comment above the constant.
- Don't re-add a port-name array beside the `port_*` counts, and don't add a
  fourth free-text column next to a constrained one. Two models for one fact is
  the problem; the count columns are the model the workbook uses.
- Don't read the workbook's XML with a regex to decide its shape. A hand-rolled
  reader reported 26 columns for `NETWORK-DEVICES` and missed four port columns
  that exist. `openpyxl` is what reads it correctly.
- Don't put a device password on `assets` to match the workbook's
  `Credential - Password` heading. It stays in `asset_credentials`; the form
  shows the field on the admin-only Credentials tab. See The asset inventory.
- Don't write the `usage_status` and `status` columns as if they were one thing.
  The triggers own `status` and never read `usage_status`; "Lent out" and
  `assigned` describe the same situation and are deliberately not kept in step.
- Don't add an INSERT policy on `profiles`, and don't read `role` from
  `raw_user_meta_data` in `handle_new_user`. Both are privilege-escalation paths.
- Don't move `must_change_password` into the browser create step to "keep the
  function minimal". Nothing guards that column, and the write is the one that
  must not be skippable. See The temporary password is a prompt, not a boundary.
- Don't turn the password gate into a route. A route is reachable around by
  typing a path; wrapping `<Outlet />` is what makes it cover every screen.
- Don't make the password gate fail closed on a missing profile. It would lock
  a working account out of the one screen that could fix whatever broke.
- Don't add a button to the user list that clears `must_change_password` for
  somebody else. An admin can do it, but it belongs to the account holder.
- Don't answer the function's `OPTIONS` preflight with an error, or with a
  response that omits `Access-Control-Allow-Origin`. The gateway passes `OPTIONS`
  straight through, so the function is the only thing that can answer it, and
  getting it wrong drops the real `POST` without a word in the logs. The local
  stack adds CORS itself and cannot reproduce it — verify with `--linked`.
- Don't add an `OPTIONS` branch that returns a bare 200. It has to echo the
  matching `Access-Control-Allow-Origin`, `Allow-Methods` and `Allow-Headers`,
  or the browser still refuses the response body.
- Don't hand-write `Access-Control-Allow-Headers`. The SDK sends
  `X-Client-Info` on every request, and the list grows with the dependency —
  import `corsHeaders` from `@supabase/supabase-js/cors` instead.
- Don't call `auth.admin.deleteUser` expecting the cascade to clean up
  `profiles`. It cannot, and the failure reads as a database error. See Why a
  hard delete cannot rely on the cascade.
- Don't report a gateway `UNAUTHORIZED_*` body as `unknown`. It has `code`, not
  `error`, and it means the session expired — see the two error shapes above.
- Don't trust `mustChangeFlagSet` being absent from a function response as
  success. The client defaults it to `false` on purpose, because claiming the
  user will be asked to change a password nothing will ask them for is the worse
  lie.
- Don't re-add a first-signup admin grant, in `handle_new_user` or anywhere else.
  Promote people with the documented procedure instead. See Promoting the first
  admin.
- Don't leave `profiles_protect_role` disabled. If a promote seems to need it off,
  it is three statements and the third one puts it back.
- Don't re-run the backfill `update` in `20260927000600_profiles_email.sql` as
  written. `profiles_protect_email` refuses it, because `is_admin()` reads
  `auth.uid()` and there is no JWT. Toggle the trigger off and back on, the same
  way the role column works.
- Don't leave `profiles_protect_email` or `profiles_guard_last_admin` disabled.
  The first is the only thing stopping a signed-in user from rewriting the
  address the admin list shows; the second is the only thing between a
  one-statement admin lockout and the documented manual recovery.
- Don't call `getAllUsers` before checking `useIsAdmin()`. RLS will not error; it
  will quietly hand a staff member a single row, which reads like a broken list.
- Don't treat a resolved `updateUserRole` as proof the role changed. A non-admin's
  write matches zero rows and PostgREST still reports success.
- Don't write `assets.status` from the client to mean "available" or "assigned".
  Those two values follow the loans and `assets_guard_status` will reject a write
  that disagrees. If you need to retire or damage something, write that — nothing
  overwrites it. See Asset status follows the loans.
- Don't add a trigger on `assignments` alone and call the status synced. The
  guard on `assets` is the half that stops the contradiction being written back.
- Don't drop `set search_path = public` from a `security definer` function.
- Don't put a `service_role` key anywhere to "fix" a migration problem. PostgREST
  cannot run DDL; that needs the CLI.
- Don't trust a production build until you have checked the bundle size. An
  empty `.env.local` produces a green build with no auth code in it. See the
  empty-env build trap.
- Don't push a migration without running `db reset --local` first. The remote has
  no re-apply path.
- Don't treat `db push --dry-run` as a gate. It exits 0 with `Remote database is
  up to date.` even when the schemas have drifted. `db diff --linked` is the real
  check.
- Don't use `--linked` for day-to-day schema experiments. It mutates the real
  project. Use `--local` and keep `--linked` for verification.
- Don't drop the local stack while a migration is half-tested — `db reset --local`
  is the only cheap way back.
- Don't repair a lost trigger by editing `002`. Its version is already in
  `schema_migrations`, so the edit would never run. Add a new migration. See
  Repairing a lost trigger.
