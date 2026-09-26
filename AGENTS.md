# AGENTS.md — Asset Management App

> Guidance for AI agents and contributors. Every claim below describes the
> repository **as it actually is**. If you find something here that no longer
> matches the code, fix this file in the same change.

## Current state

This is an empty React admin starter. The application shell is complete and
working — sidebar, header, theming, i18n, auth pages, calendar — wrapped around
a blank dashboard.

The asset management domain is **not implemented**. There is no asset, category,
location, assignment, or maintenance code anywhere in `src/`. `@supabase/supabase-js`
is installed as the intended backend but is **not imported by any file**.

Every demo page from the original template has been deleted. What remains in
`src/components/` is either shell, feature, or a deliberate component-library
primitive. Do not treat any of it as example data.

## Stack

- **React 19**, strict **TypeScript 5.9**, bundled by **Vite 8** with rolldown.
- **react-router 8** — the package is `react-router`, *not* `react-router-dom`.
- **Tailwind CSS v4**, configured entirely through `src/index.css`. There is no
  `tailwind.config.js`, and you must not add one.
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
npm run lint      # eslint . — currently 0 errors, 4 warnings
npm run preview   # serve dist/
```

`npm run lint` has 4 warnings, all `react-refresh/only-export-components`, from
files that export a hook next to a component. They are pre-existing and
acceptable. **Adding a new lint error is a regression**; adding a new warning of
that same rule is not, but say so in the PR.

`npm run build` must pass before you push. There is no CI to catch it for you.

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
├── App.tsx                    ALL routes live here — 7 <Route> elements
├── main.tsx                   entry: providers, i18n bootstrap, global CSS
├── index.css                  @theme tokens (133), @utility classes, vendor overrides
├── pages/
│   ├── Dashboard/Dashboard    the blank "/" page
│   ├── AuthPages/             SignIn, SignUp, AuthPageLayout (shared shell, not a route)
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
│   ├── auth/                  SignInForm SignUpForm
│   └── calendar/              the calendar feature: Calendar CalendarEventModal
│                              CalendarEventItem CalendarViewSelect icons types
├── layout/                    AppLayout AppSidebar AppHeader Backdrop
├── context/                   ThemeContext SidebarContext LanguageContext
├── hooks/                     useModal useClickOutside
├── i18n/                      index.ts bootstrap, languages.ts registry
├── locales/en/common.json     the only locale file — 10 keys
├── icons/                     29 .svg + index.ts barrel (SVGR named exports)
├── utils/index.ts             cn()
├── svg.d.ts                   ambient types for the SVGR `?react` import
└── vite-env.d.ts
```

## Routing

- Every route is registered in `src/App.tsx`. Add new pages there, nowhere else.
- Two groups: `<AppLayout>` (sidebar + header) for app pages, and bare routes for
  `/signin` and `/signup`. `path="*"` is the 404 fallback.
- New page → create `src/pages/<Category>/MyPage.tsx` with a default export, then
  add its `<Route>` inside the `<AppLayout>` group.

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
- Global state goes through the existing `useSidebar`, `useTheme`, and
  `useLanguage` contexts. Do not add a provider without a clear need.

## Internationalisation

- i18next is bootstrapped once in `src/i18n/index.ts`, imported by `src/main.tsx`.
  Never re-initialise it.
- One namespace, `"common"`. One locale, `en`. The file is
  `src/locales/en/common.json` — add new keys there. It holds 10 keys today.
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
| `@supabase/supabase-js` stays, despite nothing importing it | Requested by the project owner as the intended backend. Wiring it up is planned separately |
| `src/components/calendar/*` stays | The one genuinely original feature, not template code. Not asset-management related, but it proves the repo has its own work in it |
| i18n stays | The sidebar, header, and user dropdown are already translated |
| Auth pages stay | The form markup and validation shape are sound. Only the submit handlers need replacing with real auth |
| The 13 primitives stay | They are the component library. Deleting them for lack of consumers throws away working UI |
| `/signin` and `/signup` are not in the sidebar | Intentional. The auth shell is reachable by URL so it stays out of the way of domain navigation |
| The "Asset Management" sidebar row is non-clickable | It marks where domain navigation will go. A `disabled` row cannot dead-link to a 404 |

## Known rough edges

Real, verified, and left alone on purpose. Fix them if you touch the area, but do
not go looking for them unprompted.

- `vite.config.ts` has an `onwarn` handler that skips `EVAL` warnings for
  `jsvectormap`. That dependency was removed during cleanup, so the handler is
  dead config.
- `src/components/calendar/Calendar.tsx` calls `checkMobile()` immediately inside
  a `useEffect`, which is the same set-state-in-effect anti-pattern that was
  cleaned up elsewhere. ESLint does not flag it because the `setState` call is
  nested inside a function.
- `src/components/header/UserDropdown.tsx` has an effect whose entire body is a
  cleanup that calls `setState`. Setting state during unmount cleanup has been a
  no-op since React 18, so this is dead code.
- **`npx prettier --check` is unusable as configured.** There is no
  `.gitattributes`, and `core.autocrlf=true` on Windows checks files out as CRLF
  while Prettier defaults to `endOfLine: "lf"`. Every one of the 61 source files
  fails the check, including files that were just run through
  `prettier --write`. Use `npx prettier --check --end-of-line crlf` to see real
  drift — currently 11 files, one of which is `src/context/SidebarContext.tsx`,
  which predates the setup and still uses 4-space indentation and single quotes.
  Adding `.gitattributes` would fix the line-ending half of this properly.
- `package.json` has no `engines` field, so the Node `^20.19.0 || >=22.12.0`
  requirement from Vite 8 is unenforced.
- Identity-based resets assume a stable key from the caller.
  `CalendarEventModal` remounts its form on `selectedEvent.id`, and every event
  does carry an `id`. `AppSidebar` scopes its manual submenu toggle to
  `location.pathname`. Both would misbehave if a caller passed unstable identity.

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
- Don't hardcode hex colors in `className`.
- Don't use physical directional utilities (see Styling).
- Don't inline SVG markup.
- Don't use CSS-in-JS or CSS Modules.
- Don't add a locale without adding the matching JSON file.
- Don't set state synchronously inside `useEffect`. The lint rule catches the
  obvious cases, but it does **not** see a `setState` nested inside a function
  that the effect calls. Check by reading.
