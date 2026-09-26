# Asset Management App

Admin dashboard for managing assets, built with React 19, TypeScript, Vite, and Tailwind CSS v4.

> **Project status: early stage.** The repository currently contains the application
> shell and a component library only. The asset management domain — assets, categories,
> locations, assignments, maintenance — **has not been implemented yet**. Every screen
> below the dashboard is still template scaffolding or a UI component demo, and the
> dashboard itself renders placeholder e-commerce data. Treat the current UI as a
> starting point to replace, not as finished work.

## Tech stack

| Concern | Choice |
| --- | --- |
| UI | React 19, TypeScript 5.8 (strict) |
| Build | Vite 8, `@vitejs/plugin-react` |
| Styling | Tailwind CSS v4 (configured entirely in `src/index.css` — no config file) |
| Routing | react-router 8 (`BrowserRouter`) |
| Charts | ApexCharts via `react-apexcharts` |
| Calendar | `@fullcalendar/react` |
| Maps | `jsvectormap` |
| i18n | i18next + react-i18next (English only) |
| Backend | `@supabase/supabase-js` (installed, not yet wired up) |
| Icons | `vite-plugin-svgr`, barrel export in `src/icons/index.ts` |

## Requirements

- Node.js `^20.19.0 || >=22.12.0` (required by Vite 8)

## Getting started

```bash
npm install
npm run dev
```

Vite prints the local URL, by default <http://localhost:5173>.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | Type-check with `tsc -b`, then build to `dist/` |
| `npm run preview` | Serve the production build from `dist/` |
| `npm run lint` | Run ESLint across the project |

## Routes

All routes are registered in a single place: `src/App.tsx`.

| Path | Page |
| --- | --- |
| `/` | Dashboard (`pages/Dashboard/Ecommerce.tsx`) |
| `/profile` | User profile |
| `/calendar` | Calendar |
| `/blank` | Blank page starter |
| `/form-elements` | Form element demos |
| `/basic-tables` | Basic table demo |
| `/alerts` `/avatars` `/badge` `/buttons` `/images` `/videos` | UI element demos |
| `/line-chart` `/bar-chart` | Chart demos |
| `/signin` `/signup` | Auth pages (no app layout) |
| `*` | 404 fallback |

## Project structure

```
src/
├── App.tsx              # router — every route is registered here
├── main.tsx             # entry point: providers, global CSS imports
├── index.css            # Tailwind v4 @theme tokens, @utility classes, overrides
├── pages/               # route-level components
├── components/
│   ├── ui/              # primitives: alert, avatar, badge, button, dropdown,
│   │                    #   modal, table, images, videos
│   ├── form/            # form controls: input/, select, multiselect, date-picker,
│   │                    #   switch, phone input, form-elements demos
│   ├── common/          # PageMeta, PageBreadCrumb, ComponentCard, ThemeToggleButton
│   ├── header/          # AppHeader dropdowns
│   ├── calendar/        # calendar UI built on FullCalendar
│   ├── charts/          # chart wrappers
│   ├── ecommerce/       # dashboard widgets (placeholder data)
│   ├── UserProfile/     # profile page sections
│   └── tables/          # table demos
├── layout/              # AppLayout, AppSidebar, AppHeader, Backdrop
├── context/             # ThemeContext, SidebarContext, LanguageContext
├── hooks/               # useModal, useClickOutside
├── i18n/                # i18next bootstrap and language registry
├── locales/en/common.json
├── icons/               # 29 SVG files + index.ts barrel
└── utils/               # cn() class-name helper
```

## Conventions

- **Path alias** `@/*` maps to `src/*`.
- **Icons** are imported by name from `@/icons`. To add one, drop the `.svg` into
  `src/icons/` and add a named export to `src/icons/index.ts`. Never inline SVG markup.
- **Page metadata** — every page renders `<PageMeta title="…" description="…" />` as its
  first child.
- **Styling** uses Tailwind theme tokens (`brand-*`, `gray-*`, `text-theme-*`,
  `shadow-theme-*`). Reuse the `@utility` classes already defined in `index.css`.
  Never create a `tailwind.config` file.
- **Internationalization** — add user-facing strings to `src/locales/en/common.json` and
  read them with `useTranslation()`. English is currently the only locale.
- **Dark mode** is class-based; every styled element needs its `dark:` variant.

See [`AGENTS.md`](./AGENTS.md) for the detailed contribution guide.

## Credits

Built on top of [TailAdmin React](https://tailadmin.com) (MIT), a free React + Tailwind
admin dashboard template. See [`LICENSE.md`](./LICENSE.md).
