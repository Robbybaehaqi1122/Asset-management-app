# AGENTS.md — Asset Management App

> Guidance for AI agents and contributors. Every claim below describes the
> repository **as it actually is**. If you find something here that no longer
> matches the code, fix this file in the same change.

## Current state

The application shell is complete and working — sidebar, header, theming, i18n,
auth pages, calendar — wrapped around a blank dashboard. **Supabase auth is now
wired up**: email/password sign in, sign up, password reset, session persistence,
and route protection all go through a real backend.

The asset management domain is still **not implemented**. There is no asset,
category, location, assignment, or maintenance code anywhere in `src/`. The
schema for those tables is defined in `supabase/migrations/` and applied, but
nothing reads or writes them yet, and nothing in `src/` knows the schema exists.
See Database.

The "Sign in with Google" and "Sign in with X" buttons on both auth forms are
rendered but permanently `disabled`. They are placeholders, not a bug.

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
bundle is 199 kB instead of 961 kB, and contains no auth code at all. The app is
unusable and nothing tells you.

So **a suspiciously small production bundle is the symptom, not the goal.** If
`dist/assets/*.js` drops to roughly 200 kB, the credentials were empty at build
time. In dev the Vite error overlay shows the real message; in production you get
a white screen. Check the credentials before trusting a build.

Real sizes, for reference: 961.59 kB / 272.69 kB gzipped with Supabase wired
in, against 199.17 kB / 63.26 kB gzipped before it. Adding Supabase roughly
quadruples shipped JavaScript, because `@supabase/supabase-js` bundles
realtime/websocket, PostgREST, and the storage client that this app does not use
yet. There is no official auth-only subpackage for v2; `@supabase/auth-js` would
be the only lever, and it is a transitive dependency, so switching would mean
adding it explicitly. Not done. Revisit if bundle size becomes a real problem.

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
│                              profiles query), authErrors.ts (code -> i18n key)
├── pages/
│   ├── Dashboard/Dashboard    the blank "/" page
│   ├── AuthPages/             SignIn, SignUp, ResetPassword, AuthPageLayout (shell, not a route)
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
│   ├── auth/                  SignInForm SignUpForm ResetPasswordForm
│   │                          RequireAuth PublicOnlyRoute AuthLoading
│   └── calendar/              the calendar feature: Calendar CalendarEventModal
│                              CalendarEventItem CalendarViewSelect icons types
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
└── migrations/                the schema, applied in filename order
    ├── 20260927000100_schema.sql     6 tables, 10 explicit indexes
    ├── 20260927000200_triggers.sql   6 functions, 8 triggers
    └── 20260927000300_rls.sql        grants, RLS, 14 policies
    └── 20260927000400_drop_first_admin_grant.sql  handle_new_user always 'staff'
    └── 20260927000500_sync_asset_status_with_assignments.sql  status/loan sync

.github/
├── ISSUES_KNOWN.md            known problems, grouped by severity
└── ISSUE_TEMPLATE/            known-issue.yml
```

## Database

`supabase/migrations/` holds the schema, applied to project
`dnyszknpinqvcfkmoauz` (Postgres 17.6.1). Five migrations, in order:

| File | Contents |
|---|---|
| `20260927000100_schema.sql` | 6 tables, 10 explicit indexes, column comments |
| `20260927000200_triggers.sql` | `set_updated_at`, `handle_new_user`, 2 maintenance guards, `is_admin`, `protect_profile_role` |
| `20260927000300_rls.sql` | grants, `enable`/`force row level security` on all 6 tables, 14 policies |
| `20260927000400_drop_first_admin_grant.sql` | `handle_new_user` redefined to always insert `staff`; see Promoting the first admin |
| `20260927000500_sync_asset_status_with_assignments.sql` | 2 triggers keeping `assets.status` honest; see Asset status follows the loans |

**All five are applied to the remote.** `db diff --linked` reports `No schema
changes found`, so the files and the live database agree.

Note that `db push` printed `Remote database is up to date.` immediately after
applying 004, with no "Applying migration" line. That message is not a reliable
signal in either direction — confirm a push landed by reading
`supabase_migrations.schema_migrations`, not by trusting the CLI's wording.

`pg_indexes` reports 19 for `public`, not 10: Postgres adds an index for every
primary key and unique constraint automatically. The other 9 are 6 primary keys
plus the `unique` on `assets.asset_code`, `categories.name`, and
`locations.name`.

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
`20260927000500` status/loan sync. That table, not the schema itself, is what the
CLI consults to decide what is pending, and it is also the only trustworthy way to
confirm a push landed.

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
  2. `<PublicOnlyRoute>` wraps `/signin` and `/signup` — redirects a signed-in
     user to `/`.
  3. `/reset-password` is a bare route, deliberately **outside both guards**.
     Supabase's recovery link creates a session on arrival, so `PublicOnlyRoute`
     would bounce the user straight back to `/` and the reset could never
     complete.
- `path="*"` is the 404 fallback.
- New page → create `src/pages/<Category>/MyPage.tsx` with a default export, then
  add its `<Route>` inside the right group.
- `/profile` is inside the `RequireAuth` group, not beside it. It reads the
  signed-in user's own row, so there is nothing for an anonymous visitor to see
  and `PublicOnlyRoute` would only bounce a signed-in user away from it.

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
The hosted project needs the equivalent under Authentication → URL
Configuration, which cannot be changed from the repo.

The recovery link itself is a `303` to the app carrying `access_token` and
`type=recovery` **in the URL fragment**, with no `code`. That is what
`flowType: "implicit"` and `detectSessionInUrl: true` exist to consume, and it is
why the fragment — not a query parameter — is the thing that must survive.

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

`anon` is granted **no privileges at all** on any of the 6 tables — not merely
"no matching policy". A policy mistake therefore cannot leak to unauthenticated
callers even in principle. There are no `anon` policies anywhere.

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
reach `/signup` would have owned the database. `20260927000400` removed it.

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
  `src/locales/en/common.json` — add new keys there. It holds 94 leaf keys
  today, under `sidebar`, `header`, `userDropdown`, `auth`, and `profile`.
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
- Interpolation delimiters are `{` and `}`, not the i18next default.
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
| No first-signup admin grant; the first admin is promoted by hand | The owner chose to close it (#39) over keeping it for convenience. The remote had 0 users with signup open, so the grant was an unclaimed admin for anyone who found the URL. The cost is a fresh project starts read-only — see Promoting the first admin |
| `@supabase/supabase-js` is the backend, wired for email/password auth | Requested by the project owner. It costs ~760 kB of extra JavaScript, most of it realtime/PostgREST/storage this app does not use yet, but the owner wants this client |
| The social sign-in buttons are `disabled` rather than removed | The owner chose to defer OAuth. Keeping the buttons visible preserves the layout; `auth.oauthNotReady` explains them via `title` |
| `google.svg` keeps its brand hexes instead of theme tokens | The Google logo is genuinely multi-colour — `#4285F4`, `#34A853`, `#FBBC05`, `#EB4335` are what makes it the Google logo. Recolouring it with a token would stop it being the logo at all, so the "no hardcoded hex" rule has a documented exception here and only here. `x.svg` is monochrome and uses `currentColor`, so it follows the button's text colour in both themes on its own |
| `src/components/calendar/*` stays | The one genuinely original feature, not template code. Not asset-management related, but it proves the repo has its own work in it |
| i18n stays | The sidebar, header, and user dropdown are already translated |
| Auth pages stay | The form markup and validation shape were sound. The submit handlers were replaced with real Supabase calls; the surrounding markup is unchanged |
| `/reset-password` is outside both route guards | A recovery link creates a session on arrival, so any redirect guard fights the flow. See Routing |
| The 13 primitives stay | They are the component library. Deleting them for lack of consumers throws away working UI |
| `/signin` and `/signup` are not in the sidebar | Intentional. The auth shell is reachable by URL so it stays out of the way of domain navigation |
| The "Asset Management" sidebar row is non-clickable | It marks where domain navigation will go. A `disabled` row cannot dead-link to a 404 |

## Known rough edges

Real, verified, and left alone on purpose. Fix them if you touch the area, but do
not go looking for them unprompted.

- `package.json` has no `engines` field, so the Node `^20.19.0 || >=22.12.0`
  requirement from Vite 8 is unenforced.
- Identity-based resets assume a stable key from the caller.
  `CalendarEventModal` remounts its form on `selectedEvent.id`, and every event
  does carry an `id`. `AppSidebar` scopes its manual submenu toggle to
  `location.pathname`. Both would misbehave if a caller passed unstable identity.
- The three `DropdownItem`s in `UserDropdown` all point at `/profile`, and they
  now land on a real page, but they are three labels for one destination:
  "Edit profile", "Account settings" and "Support" are the same read-only view.
  The page is read-only, so "Edit profile" overpromises. Either build the edit
  capability or collapse the three into one item.
- `useIsAdmin()` has exactly one caller, the role badge on `/profile`. That is
  enough to keep it honest but not enough to demonstrate the RLS layer end to
  end: no screen yet hides a write action, because the asset screens that would
  need it do not exist. Do not read the badge as that proof.
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
- Don't add demo image assets. `public/images/` holds 13 files, all referenced.
- Don't delete a primitive because reachability tooling reports it as an orphan.
  See the 13-primitives section.
- Don't hardcode user-facing text in the shell — add a key to
  `src/locales/en/common.json` and use `t()`. Note that page-level content in
  `Dashboard.tsx` and `Blank.tsx` is currently hardcoded English, so the rule is
  inconsistently applied; be consistent within the file you touch.
- Don't pass a key path as the i18next namespace argument.
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
- Don't edit the three applied migrations or add `if not exists` to make them
  re-runnable. New schema goes in a new migration. See Database.
- Don't run `supabase` CLI commands from outside the repo root. `link` is
  directory-scoped and the failure is confusing. See Database.
- Don't create a policy for `anon`. It holds no grants on purpose; the absence of
  grants is the protection.
- Don't add an INSERT policy on `profiles`, and don't read `role` from
  `raw_user_meta_data` in `handle_new_user`. Both are privilege-escalation paths.
- Don't re-add a first-signup admin grant, in `handle_new_user` or anywhere else.
  Promote people with the documented procedure instead. See Promoting the first
  admin.
- Don't leave `profiles_protect_role` disabled. If a promote seems to need it off,
  it is three statements and the third one puts it back.
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
