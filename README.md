# Asset Management App

An empty admin starter: a working application shell (sidebar, header, theming,
i18n, auth pages, calendar) wrapped around a blank dashboard.

The asset management domain is **not built yet**. There is no asset, category,
location, assignment, or maintenance code anywhere in `src/`. The shell exists
so that work can start immediately without re-deriving the layout plumbing.

## Requirements

- **Node `^20.19.0` or `>=22.12.0`** — required by Vite 8. `package.json` has
  no `engines` field, so your package manager will not enforce this for you.
- npm

## Getting started

```bash
npm install
npm run dev
```

The dev server prints its URL, by default <http://localhost:5173>.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | `tsc -b && vite build`. This is the gate that matters — it type-checks, so a type error fails the command |
| `npm run lint` | ESLint. Currently **0 errors, 4 warnings**; the warnings are all `react-refresh/only-export-components` |
| `npm run preview` | Serve the built `dist/` |

There is no CI. `npm run build` and `npm run lint` are the only automated checks,
so run both before pushing.

## Routes

Every route lives in `src/App.tsx` — nowhere else.

| Path | Page | Shell |
|---|---|---|
| `/` | `pages/Dashboard/Dashboard.tsx` | sidebar + header |
| `/calendar` | `pages/Calendar.tsx` | sidebar + header |
| `/blank` | `pages/OtherPage/Blank.tsx` | sidebar + header |
| `/signin` | `pages/AuthPages/SignIn.tsx` | bare |
| `/signup` | `pages/AuthPages/SignUp.tsx` | bare |
| anything else | `pages/OtherPage/NotFound.tsx` | bare |

`/signin` and `/signup` are reachable by URL but are **not** listed in the
sidebar. The sidebar's "Asset Management" row is a deliberately non-clickable
placeholder that marks where domain navigation will go.

## Retained component library

Thirteen primitives were deliberately kept during cleanup. Twelve of them have
**no consumer anywhere in the app** — that is expected, not dead code. They are
the starter's component library, and deleting them because reachability tooling
flags them would throw away working UI.

| Component | Import path | Export |
|---|---|---|
| `Alert` | `@/components/ui/alert/Alert` | default |
| `Avatar` | `@/components/ui/avatar/Avatar` | default |
| `Badge` | `@/components/ui/badge/Badge` | default |
| `ComponentCard` | `@/components/ui/ComponentCard` | default |
| `Table` | `@/components/ui/table` | **named**: `Table`, `TableBody`, `TableCell`, `TableHeader`, `TableRow` |
| `DatePicker` | `@/components/form/date-picker` | default |
| `FileInput` | `@/components/form/input/FileInput` | default |
| `MultiSelect` | `@/components/form/MultiSelect` | default |
| `PhoneInput` | `@/components/form/group-input/PhoneInput` | default |
| `Radio` | `@/components/form/input/Radio` | default |
| `Select` | `@/components/form/Select` | default |
| `Switch` | `@/components/form/switch/Switch` | default |
| `TextArea` | `@/components/form/input/TextArea` | default |

`ComponentCard` is the exception — it is used by the dashboard and blank pages.

A few more primitives exist and *are* wired into the shell: `Button`, `Dropdown`,
`DropdownItem`, `Modal` (under `@/components/ui/`), and `Label`, `Checkbox`,
`InputField` (under `@/components/form/`).

## Dependencies

| Package | Why it is here |
|---|---|
| `react`, `react-dom` | 19.x |
| `react-router` | routing. The package is `react-router`, **not** `react-router-dom` |
| `@fullcalendar/react` | the calendar page. This is the only heavy third-party UI dependency left |
| `flatpickr` | date inputs, used by `components/form/date-picker.tsx` |
| `i18next`, `react-i18next` | translations. See "Internationalisation" below |
| `react-helmet-async` | per-page `<title>` via the `PageMeta` component |
| `clsx`, `tailwind-merge` | the two halves of the `cn()` helper in `src/utils/index.ts` |
| `@supabase/supabase-js` | **installed but not imported by any file.** Kept deliberately as the intended backend; still unproven |
| `typescript`, `vite`, `@vitejs/plugin-react`, `vite-plugin-svgr` | build. SVGR is what turns `src/icons/*.svg` into React components |
| `tailwindcss`, `@tailwindcss/postcss`, `postcss` | styling. There is no `tailwind.config.js` and you must not add one |
| `eslint`, `@eslint/js`, `typescript-eslint`, `globals`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` | linting |
| `prettier`, `prettier-plugin-tailwindcss` | formatting. See "Formatting" below |
| `@types/react`, `@types/react-dom`, `@types/node` | ambient types |

## Internationalisation

One namespace, one locale. `src/i18n/index.ts` registers only `common`, and
`fallbackNS` is not set.

- Locale file: `src/locales/en/common.json` — **10 keys**
- Registry: `src/i18n/languages.ts`
- `LanguageContext` keeps i18next, `localStorage`, and `<html lang>` / `dir` in sync
- Interpolation delimiters are `{` and `}`, not the i18next default

To scope a subtree, pass `keyPrefix`:

```tsx
const { t } = useTranslation("common", { keyPrefix: "header" });
t("searchPlaceholder");
```

Never pass a key path as the namespace argument. `useTranslation("header")` looks
like it works, and silently renders the raw key names, because nothing is
registered under a `header` namespace and there is no fallback.

## Project structure

```
src/
├── App.tsx                    all routes
├── main.tsx                   entry: providers, global CSS
├── index.css                  @theme tokens, @utility classes, vendor overrides
├── pages/
│   ├── Dashboard/Dashboard    the blank "/" page
│   ├── AuthPages/             SignIn, SignUp, AuthPageLayout (shared shell)
│   ├── Calendar.tsx
│   └── OtherPage/             NotFound, Blank
├── components/
│   ├── ui/                    alert avatar badge button dropdown modal table
│   │                          + ComponentCard
│   ├── form/                  date-picker, input, select, MultiSelect, switch,
│   │                          group-input/PhoneInput, Label
│   ├── common/                PageMeta, PageBreadCrumb, ScrollToTop,
│   │                          ThemeToggleButton, ThemeTogglerTwo, GridShape
│   ├── header/                NotificationDropdown, UserDropdown
│   ├── auth/                  SignInForm, SignUpForm
│   └── calendar/              the calendar feature: Calendar, CalendarEventModal,
│                              CalendarEventItem, CalendarViewSelect, icons, types
├── layout/                    AppLayout, AppSidebar, AppHeader, Backdrop
├── context/                   ThemeContext, SidebarContext, LanguageContext
├── hooks/                     useModal, useClickOutside
├── i18n/                      index.ts bootstrap, languages.ts registry
├── locales/en/common.json     the only locale file
├── icons/                     31 .svg + index.ts barrel (SVGR named exports)
└── utils/index.ts             cn()
```

## Adding a page

1. Create `src/pages/<Category>/<PageName>.tsx` with a default export. Render
   `<PageMeta title="…" description="…" />` first and `<PageBreadcrumb />` at the
   top of admin pages.
2. Register it in `src/App.tsx` inside the `<AppLayout>` route group.
3. Add a `NavItem` to `navItems` in `src/layout/AppSidebar.tsx` if it should
   appear in navigation. Give it a `key` and add a matching
   `sidebar.items.<key>` string to `src/locales/en/common.json`.

`pages/OtherPage/Blank.tsx` is the smallest working example.

## Conventions

The full rules live in [`AGENTS.md`](./AGENTS.md). The short version:

- Path alias `@/*` → `src/*`, configured in both `tsconfig.app.json` and `vite.config.ts`
- Tailwind v4 only. Tokens live in the `@theme` block in `src/index.css` (133 of
  them). Prefer logical properties — `ms-*`, `ps-*`, `start-*`, `border-s-*` — over
  physical ones for RTL readiness
- Dark mode is class-based. `ThemeContext` puts `.dark` on `<html>`, and every
  styled element needs a `dark:` variant
- New icon: drop the `.svg` in `src/icons/` and add a named export to
  `src/icons/index.ts`. Never inline SVG markup

## Formatting

Prettier is a dev dependency with `prettier-plugin-tailwindcss` configured
(`.prettierrc` points it at `src/index.css` and `cn`). It is **not** run
automatically.

```bash
npx prettier --write src/path/to/file.tsx
```

Do not trust `npx prettier --check` as a gate. There is no `.gitattributes`, and
with `core.autocrlf=true` on Windows files are checked out as CRLF while Prettier
defaults to `endOfLine: "lf"` — so all 61 source files report as unformatted,
including ones just written by Prettier. To see real drift, which is currently 11
files, pass the line ending explicitly:

```bash
npx prettier --check --end-of-line crlf "src/**/*.{ts,tsx,css}"
```

`src/context/SidebarContext.tsx` is one of them — it predates the Prettier setup
and still uses 4-space indentation and single quotes. Reformatting it is harmless
but produces a large diff, so it has been left alone.

## Credits

The layout, sidebar, header, and much of the component styling come from
[TailAdmin](https://tailadmin.com), used under the MIT License. See
[`LICENSE.md`](./LICENSE.md). Please keep the credit when you fork this.
