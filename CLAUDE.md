# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

`acts` — a Korean accounting system (Phase 1A foundation + auth + admin; Phase 1B chart of accounts, partners, sites/departments, vouchers with VAT, approval, history, evidence attachments; Phase 1C ledgers and statements: 분개장, 계정별/거래처별 원장, 합계잔액시산표, 손익계산서, 재무상태표, Excel export; Phase 1D executive dashboard, month close, opening balances, 결산 vouchers, year close) on Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn/ui using the **Base UI** primitives (`@base-ui/react`, shadcn style `base-nova`), not Radix. Postgres via Drizzle ORM. The other dashboard/apps pages inherited from the shadcnuikit.com template are still mock data.

## Commands

Package manager is **pnpm**. Ports: app 3710, Postgres 5710 (override with `APP_PORT` / `DB_PORT` in `.env`).

```bash
docker compose up -d db  # dev database only (prod services are under profile `prod`)
pnpm db:migrate          # apply Drizzle migrations (drizzle/)
pnpm db:seed             # idempotent; creates admin from ADMIN_EMAIL / ADMIN_PASSWORD (refuses empty / "change-me-now"), the Douzone-style standard chart and the `본점` site (runs on every deploy via the `migrate` service)
NEW_PASSWORD=... pnpm admin:reset-password <email>  # reset password, clear lock, drop sessions
pnpm dev                 # dev server at http://localhost:3710
pnpm build               # production build (does NOT run lint)
pnpm lint                # eslint — run separately from build
pnpm test                # vitest (needs the db up)
pnpm test:e2e            # Playwright, all specs

pnpm exec playwright test e2e/auth.spec.ts      # single spec file
pnpm exec playwright test -g "title fragment"   # single test by title
```

Local `.env` must set `ADMIN_PASSWORD` (non-default, >= 8 chars) and `COOKIE_SECURE=false` (plain-http dev/e2e; `.env.example` leaves both out so production defaults to secure cookies). `ADMIN_PASSWORD` is only used on the first seed.

Playwright's `webServer` runs `pnpm db:migrate && pnpm db:seed && pnpm build && pnpm start` on :3710, so tests hit a **production build**. Locally it reuses a server already on :3710 — if `pnpm dev` is running, tests run against dev instead (and a stale server means stale code).

Deploy: `docker compose --profile prod up -d --build` (db, migrate, app, cloudflared) on the server; `scripts/backup.sh` for Postgres dumps plus an uploads-volume archive. See `docs/deploy.md` (Korean). `next.config.ts` uses `output: "standalone"`.

## Architecture

- **Route groups:** `src/app/(dashboard)` wraps pages in the app shell (`SidebarProvider` + `AppSidebar` + `AppHeader`); `src/app/(auth)` uses a bare centered layout. `/` redirects to the role's home (staff → `/vouchers`, others → `/overview`).
- **`src/lib/nav.ts` is the sitemap.** `navGroupsFor(role)` (items carry a `permission`) drives the sidebar *and* the ⌘K command palette, and `allNavItems` drives `e2e/smoke.spec.ts`, which renders every route and fails on HTTP ≥400 or uncaught page errors. Adding a route means adding it here.
- **Server layering.** Domain services in `src/server/<area>/service.ts` take `db` first and return a `Result` (`src/server/result.ts`). Pages and actions go through `src/server/auth/dal.ts` (`verifySession`, `requirePermission`); `src/proxy.ts` is only an optimistic cookie check. The permission matrix is `src/lib/permissions.ts`. Tests: Vitest runs against the real `acts_test` DB (`tests/helpers/db.ts`); e2e uses a stored admin session from `e2e/auth.setup.ts`. Vitest tests get reference data from `seedReference(db)`; Playwright projects: `chromium` (app specs), `showcase` (flaky template specs, so they cannot block the rest), then `settings-serial` → `settings-serial-approval` → `settings-serial-closing` (`closing.spec.ts`, serial, fiscal year 2000 only) run the specs that change shared state.
- **Reports aggregate posted lines on the fly** (no summary tables); at a 500k-line year the statements take ~150 ms, journal page 1 ~0.5 s, and the account-ledger page ~0.4 s because the page is paged 1,000 lines at a time (`getAccountLedger(..., { page })`; unpaged = full ledger for Excel). Perf test: `PERF=1 pnpm test src/server/reports/perf.test.ts`.
- **Thin pages, fat feature folders.** `page.tsx` files only compose components. Each feature lives in a folder mirroring its route:
  - `src/components/dashboards/<name>/` (shared bits in `dashboards/shared/`)
  - `src/components/apps/<name>/` — usually a client component plus a co-located `data.ts` with mock data and types
  - `src/components/pages/<name>/` — the `/components/*` showcase pages (`components-<name>/variants.tsx`) and misc pages (settings, profile, pricing, …)
  - `src/components/layout/` — sidebar, header, breadcrumbs, command palette, notifications, theme
  - `src/components/ui/` — shadcn/ui primitives (generated; add via the shadcn CLI per `components.json`)
- **Vouchers** (`src/server/vouchers/`, `src/lib/vouchers/`): a voucher is a header plus >= 2 lines. The three transaction-type forms go through the pure builder `src/lib/vouchers/simple.ts` (`buildSimpleVoucher` / `toSimpleInput`); the service re-validates non-general vouchers by rebuilding them. **Posted rule:** only `status = 'approved'` counts (`POSTED_STATUSES`); turning approval off auto-approves pending vouchers. Every voucher write adds a `voucher_history` row in the same transaction (`snapshot.ts`). Numbering is per date under an advisory lock; updates use an optimistic `version`.
- **Reports** (`src/server/reports/`: `totals.ts`, `service.ts`, `ledgers.ts` run the SQL aggregation of posted lines; pure builders live in `src/lib/reports/`). Balance-sheet groups accumulate from the beginning of time, P&L groups from the fiscal-year start (`company.fiscalYearStartMonth`); profit from earlier fiscal years shows as the computed equity row `이월이익잉여금(전기 손익)` permanently, because year close posts no carry-forward voucher. Site and department filters apply per line. Report URLs use `from`/`to`/`site`/`dept` (plus `account`/`partner`/`page`), parsed by `parseReportParams`; Excel files come from `GET /api/exports/[report]` (exceljs).
- **Closing** (`src/server/closing/`): month close is a watermark ("closed through M", `period_closes`). Every voucher write (create, update, delete, approve, reject, attach, detach) first takes the global advisory lock `(PERIOD_LOCK, 0)` shared, then company FOR SHARE, the voucher row, then numbering; close and reopen take it exclusive. Opening balances are exactly one `kind = 'opening'` voucher on the cut-off date, and regular vouchers must be dated after it. Year close creates NO voucher: balance-sheet balances roll forward because reports accumulate from the beginning of time; it only locks and reconciles against the 세무사's figures. 결산 vouchers are `kind = 'closing'` ordinary adjusting entries.
- **Dashboard** (`/overview`, `src/server/dashboard/`): data as of yesterday. Cash, receivable and payable totals come from `accounts.dashboard_role`, not codes; the trend comes from `accountTotalsByMonth`.
- **Uploads:** evidence files live under `UPLOAD_DIR` (default `./uploads`, Docker volume `acts_uploads`), the type is sniffed from content, and they are served by `src/app/api/attachments/[id]/route.ts`. `next.config.ts` raises `serverActions.bodySizeLimit` and `proxyClientMaxBodySize` to 11mb (`proxy.ts` runs on Server Action POSTs and would truncate at 10MB).
- Global mock data/types: `src/lib/data.ts`. Theme: `next-themes` with class strategy (light/dark/system); tokens in `src/app/globals.css`.

## Gotchas

- **Base UI, not Radix.** Composition uses the `render` prop, not `asChild` (exception: the vaul-based Drawer still uses `asChild`). When a `<Button>` renders a link (`render={<Link … />}`), pass `nativeButton={false}` — `e2e/no-base-ui-warnings.spec.ts` guards against the warning.
- ESLint downgrades `react-hooks/set-state-in-effect` to a warning on purpose (SSR mount guards like `src/hooks/use-mobile.ts`).
- Work is organised in phases; design specs are in `docs/superpowers/specs/` and phase plans in `docs/superpowers/plans/`. E2E specs are named per phase/feature (`apps-2a.spec.ts`, `dashboards-finance.spec.ts`, `components-<name>.spec.ts`).
