# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

`acts` — a Korean accounting system (Phase 1A: foundation + auth + admin) on Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn/ui using the **Base UI** primitives (`@base-ui/react`, shadcn style `base-nova`), not Radix. Postgres via Drizzle ORM. The dashboard/apps pages inherited from the shadcnuikit.com template are still mock data.

## Commands

Package manager is **pnpm**. Ports: app 3710, Postgres 5710 (override with `APP_PORT` / `DB_PORT` in `.env`).

```bash
docker compose up -d db  # dev database only (prod services are under profile `prod`)
pnpm db:migrate          # apply Drizzle migrations (drizzle/)
pnpm db:seed             # idempotent; creates admin from ADMIN_EMAIL / ADMIN_PASSWORD
pnpm dev                 # dev server at http://localhost:3710
pnpm build               # production build (does NOT run lint)
pnpm lint                # eslint — run separately from build
pnpm test                # vitest (needs the db up)
pnpm test:e2e            # Playwright, all specs

pnpm exec playwright test e2e/auth.spec.ts      # single spec file
pnpm exec playwright test -g "title fragment"   # single test by title
```

Playwright's `webServer` runs `pnpm db:migrate && pnpm db:seed && pnpm build && pnpm start` on :3710, so tests hit a **production build**. Locally it reuses a server already on :3710 — if `pnpm dev` is running, tests run against dev instead (and a stale server means stale code).

Deploy: `docker compose --profile prod up -d --build` (db, migrate, app, cloudflared) on the server; `scripts/backup.sh` for Postgres dumps. See `docs/deploy.md` (Korean). `next.config.ts` uses `output: "standalone"`.

## Architecture

- **Route groups:** `src/app/(dashboard)` wraps pages in the app shell (`SidebarProvider` + `AppSidebar` + `AppHeader`); `src/app/(auth)` uses a bare centered layout. `/` redirects to `/dashboard/default`.
- **`src/lib/nav.ts` is the sitemap.** `navGroups` drives the sidebar *and* the ⌘K command palette, and `allNavItems` drives `e2e/smoke.spec.ts`, which renders every route and fails on HTTP ≥400 or uncaught page errors. Adding a route means adding it here.
- **Thin pages, fat feature folders.** `page.tsx` files only compose components. Each feature lives in a folder mirroring its route:
  - `src/components/dashboards/<name>/` (shared bits in `dashboards/shared/`)
  - `src/components/apps/<name>/` — usually a client component plus a co-located `data.ts` with mock data and types
  - `src/components/pages/<name>/` — the `/components/*` showcase pages (`components-<name>/variants.tsx`) and misc pages (settings, profile, pricing, …)
  - `src/components/layout/` — sidebar, header, breadcrumbs, command palette, notifications, theme
  - `src/components/ui/` — shadcn/ui primitives (generated; add via the shadcn CLI per `components.json`)
- Global mock data/types: `src/lib/data.ts`. Theme: `next-themes` with class strategy (light/dark/system); tokens in `src/app/globals.css`.

## Gotchas

- **Base UI, not Radix.** Composition uses the `render` prop, not `asChild` (exception: the vaul-based Drawer still uses `asChild`). When a `<Button>` renders a link (`render={<Link … />}`), pass `nativeButton={false}` — `e2e/no-base-ui-warnings.spec.ts` guards against the warning.
- ESLint downgrades `react-hooks/set-state-in-effect` to a warning on purpose (SSR mount guards like `src/hooks/use-mobile.ts`).
- Work is organised in phases; design specs are in `docs/superpowers/specs/` and phase plans in `docs/superpowers/plans/`. E2E specs are named per phase/feature (`apps-2a.spec.ts`, `dashboards-finance.spec.ts`, `components-<name>.spec.ts`).
