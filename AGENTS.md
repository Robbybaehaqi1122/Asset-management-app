# AGENTS.md — Asset Management App

> Guidance for AI agents and contributors. Everything below describes the repository
> **as it actually is**. If you find a claim here that no longer matches the code,
> fix this file in the same change.

## Current state

This is the TailAdmin React free template with the Pro pages stripped out, plus a custom
interactive calendar, i18next setup, and a `cn` class-name helper. The asset management
domain is **not implemented** — there is no asset, category, location, assignment, or
maintenance code anywhere in `src/`. `@supabase/supabase-js` is installed as the intended
backend but is not imported by any file.

The screens under `pages/UiElements`, `pages/Forms`, `pages/Tables`, `pages/Charts`, and
the `ecommerce/` widgets are template demos with hardcoded data. They are kept
deliberately as a component library — reuse them, but do not mistake demo data for real
data.

## Stack

- **React 19**, strict **TypeScript 5.8**, bundled by **Vite 8**.
- **react-router 8** (`react-router`, not `react-router-dom`).
- **Tailwind CSS v4** — configured entirely through `src/index.css`. There is no
  `tailwind.config.js`, and you must not add one.
- **react-apexcharts** for charts, **@fullcalendar/react** for the calendar,
  **jsvectormap** for the demographic map, **flatpickr** for date inputs.
- **i18next + react-i18next**, single `"common"` namespace, **English only**.
- **react-helmet-async** via the `<PageMeta>` component for per-page `<title>`.
- Path alias: `@/*` → `src/*` (set in both `tsconfig.app.json` and `vite.config.ts`).
- Node `^20.19.0 || >=22.12.0` (Vite 8 requirement).

## Commands

```bash
npm run dev       # dev server with HMR
npm run build     # tsc -b && vite build  — must pass before you push
npm run lint      # eslint .
npm run preview   # serve dist/
```

`npm run build` is the gate that matters: it runs the TypeScript project build, so a
type error fails the command. `npm run lint` currently reports pre-existing
`react-hooks/set-state-in-effect` errors in `AppSidebar`, `VectorMap`, `ThemeContext`,
`SidebarContext`, `LanguageContext`, and `CalendarEventModal` — these predate your work.
Do not add new ones, and do not assume a red lint run is your fault without diffing
against `main`.

## Repo map

```
src/
├── App.tsx                    # ALL routes live here — 17 <Route> entries
├── main.tsx                   # entry: providers + global CSS imports
├── index.css                  # @theme tokens, @utility classes, vendor overrides
├── pages/
│   ├── Dashboard/Ecommerce    # the "/" dashboard
│   ├── AuthPages/             # SignIn, SignUp, AuthPageLayout (shared shell)
│   ├── Charts/                # LineChart, BarChart
│   ├── Forms/FormElements     # form control demos
│   ├── Tables/BasicTables     # table demo
│   ├── UiElements/            # Alerts, Avatars, Badges, Buttons, Images, Videos
│   ├── Calendar.tsx
│   ├── UserProfiles.tsx
│   └── OtherPage/             # NotFound, Blank
├── components/
│   ├── ui/                    # alert/ avatar/ badge/ button/ dropdown/ modal/
│   │                          #   table/ images/ videos/
│   ├── form/                  # input/ select MultiSelect date-picker switch/
│   │                          #   group-input/PhoneInput, form-elements/ demos
│   ├── common/                # PageMeta PageBreadCrumb ComponentCard
│   │                          #   ThemeToggleButton ThemeTogglerTwo ChartTab
│   │                          #   GridShape VectorMap ScrollToTop
│   ├── header/                # NotificationDropdown UserDropdown
│   ├── calendar/              # Calendar, CalendarEventModal, CalendarEventItem,
│   │                          #   CalendarViewSelect, icons, types
│   ├── charts/                # bar/BarChartOne, line/LineChartOne
│   ├── ecommerce/             # dashboard widgets (placeholder data)
│   ├── UserProfile/           # UserMetaCard UserAddressCard Security DangerZone
│   └── tables/BasicTables/    # BasicTableOne
├── layout/                    # AppLayout AppSidebar AppHeader Backdrop
├── context/                   # ThemeContext SidebarContext LanguageContext
├── hooks/                     # useModal useClickOutside
├── i18n/                      # index.ts bootstrap, languages.ts registry
├── locales/en/common.json     # the only locale file
├── icons/                     # 29 .svg + index.ts barrel (SVGR named exports)
├── utils/index.ts             # cn()
└── svg.d.ts                   # ambient types for the `?react` SVGR import
```

## Routing

- Every route is registered in `src/App.tsx`. Add new pages there, nowhere else.
- Two groups: `<AppLayout>` (sidebar + header shell) for app pages, and bare routes for
  `/signin` and `/signup`. `path="*"` is the 404 fallback.
- New page → create `src/pages/<Category>/MyPage.tsx` with a default export, then add its
  `<Route>` inside the `<AppLayout>` group.
- `AuthPageLayout.tsx` is a shared shell, not a route.

## Conventions

- Component files are PascalCase with a default export. Hook files are camelCase.
- New reusable component → `src/components/<feature>/` if domain-specific, otherwise
  `src/components/common/` or `src/components/ui/`.
- New icon → drop the `.svg` in `src/icons/`, add a named export to `src/icons/index.ts`.
  Never inline SVG markup in a component.
- Every page renders `<PageMeta title="…" description="…" />` first, and
  `<PageBreadCrumb pageTitle="…" />` at the top of admin pages.
- Demo sections are wrapped in `<ComponentCard title="…">`.
- Modals use the `useModal` hook plus the `<Modal>` primitive.
- Global state goes through the existing `useSidebar`, `useTheme`, `useLanguage`
  contexts. Do not add a provider without a clear need.

## Internationalization

- i18next is bootstrapped once in `src/i18n/index.ts`, imported by `src/main.tsx`. Never
  re-initialize it.
- One namespace, `"common"`. One locale, `en`. The file is
  `src/locales/en/common.json`; add new keys there.
- Read keys with `useTranslation()`. Scope to a subtree with `keyPrefix`:

  ```tsx
  const { t } = useTranslation("common", { keyPrefix: "ecommerce.metrics" });
  ```

  Do **not** pass a key path as the namespace argument — `useTranslation("ecommerce.demographic")`
  silently resolves against the wrong namespace and renders blanks. That bug still exists
  in `components/ecommerce/DemographicCard.tsx`; use it as the example of what not to do.
- `src/i18n/languages.ts` holds the language registry. `LanguageContext` syncs i18next,
  `localStorage`, and `<html lang>` / `dir`.
- Only `en` is enabled. If you add a locale, add a matching `src/locales/<code>/common.json`
  and register it in `languages.ts` — there is no RTL locale yet, so the `dir` plumbing is
  untested.

## Styling

- Tailwind v4 only. The theme lives in `src/index.css` under `@theme`.
- Use theme tokens, not literals: `brand-*`, `gray-*`, `blue-light`, `orange`, `success`,
  `error`, `warning` (scales `25`–`950`), `font-outfit`, `text-theme-*`, `text-title-*`,
  `shadow-theme-*`, and the `2xsm` / `xsm` / `3xl` breakpoints.
- Dark mode is class-based via `@custom-variant dark (&:is(.dark *))`, toggled by
  `ThemeContext` adding `.dark` to `<html>`. Every styled element needs a `dark:` variant.
- Prefer CSS logical properties for RTL readiness: `ms-*` / `me-*` over `ml-*` / `mr-*`,
  `ps-*` / `pe-*` over `pl-*` / `pr-*`, `start-*` / `end-*` over `left-*` / `right-*`,
  `border-s-*` / `border-e-*` for borders, `rounded-s-*` / `rounded-e-*` for radius,
  `text-start` / `text-end` for alignment. Flip directional icons with
  `rtl:rotate-180` or `rtl:-scale-x-100`.
- Reuse the `@utility` classes in `index.css` (`menu-item`, `menu-item-active`,
  `menu-item-inactive`, `menu-item-icon`, `menu-dropdown-item`, `menu-dropdown-badge`,
  `custom-scrollbar`, `no-scrollbar`, …) before adding new ones.
- Third-party CSS overrides live at the bottom of `index.css`, using `@apply`.
- `ApexOptions.colors` is the accepted exception to the no-literal-colors rule — copy hex
  values from the `@theme` palette (`#465fff` = `brand-500`, `#12b76a` = `success-500`).

## Don'ts

- Don't install packages without asking.
- Don't create a `tailwind.config` file.
- Don't add routes outside `src/App.tsx` or pages outside `src/pages/`.
- Don't hardcode user-facing text — add a key to `src/locales/en/common.json` and use `t()`.
- Don't hardcode hex colors in `className`.
- Don't use physical directional utilities (see Styling).
- Don't inline SVG markup.
- Don't use CSS-in-JS or CSS Modules.
- Don't add locales without adding the matching JSON file.
