# Phase 1A — Foundation: DB · Auth · Roles · Accounting Shell · Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the UI template into a logged-in, role-aware accounting app shell backed by PostgreSQL — admins can create users and edit company settings, every Phase 1 route exists as a placeholder in a Korean accounting menu, and the whole thing runs on the Zorin OS home server (`approid@192.168.219.174`) via Docker Compose, published at `https://acts.approid.team` through a Cloudflare Tunnel.

**Architecture:** Next.js 16 full-stack. Drizzle ORM over PostgreSQL. Database sessions: the cookie holds a random token, the DB stores its SHA-256 hash. Passwords hashed with Node's built-in `crypto.scrypt` (no native deps). Domain logic lives in `src/server/<area>/service.ts` as plain functions that take a `db` argument (unit-testable against a real test DB with Vitest); `src/server/auth/dal.ts` is the only `server-only` entry pages/actions use for session + permission checks. `proxy.ts` does an optimistic cookie-presence redirect only.

**Tech Stack:** Next.js 16.2 · React 19 · Drizzle ORM + drizzle-kit · `postgres` (postgres.js) · zod · Vitest · Playwright · Docker Compose · PostgreSQL 17.

**Spec:** [docs/superpowers/specs/2026-10-29-accounting-tax-system-design.md](../specs/2026-10-29-accounting-tax-system-design.md)

### Phase 1 split (this plan is 1A; each later part gets its own plan when 1A is done)

| Part | Scope (spec §) |
|---|---|
| **1A** (this) | DB, auth, roles/permissions, accounting menu + placeholders, user admin, company settings, Docker deploy + backup (§4, §5.5 partial, §6, §7) |
| 1B | Chart of accounts (Douzone codes, 일반기업회계기준), partners, 사업장/부서, voucher model with VAT fields, simple + general entry, approval, change history, evidence upload (§5.1, §5.1.1, §5.1.2, §5.5) |
| 1C | Journal, account/partner ledgers, trial balance, income statement, balance sheet, Excel export (§5.2, §8) |
| 1D | Executive dashboard (B안), month close, opening balances, year carry-forward, 결산 vouchers (§5.1.2, §5.1.3, §5.3, §5.4 결산·이월) |
| 1E | Account recommendation, transaction templates, Hometax tax-invoice + card Excel import, 세무사 export package (§5.1, §5.4) |

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). Next 16: Middleware is **`proxy.ts`** (`src/proxy.ts`), `cookies()` is async.
- Base UI, not Radix: compose with the `render` prop; a `<Button>` rendered as a link needs `nativeButton={false}`.
- All UI copy is **Korean**. Font is Pretendard (already set).
- Money is never a JS float in storage: KRW amounts are integer won (`bigint` columns, `mode: "number"`). (Not used in 1A, but the schema conventions start here.)
- Single company per deployment: the `company` table holds exactly one row (`id = 1`).
- Roles, verbatim: `staff` (실무자), `manager` (중간 관리자), `executive` (최고 관리자), `admin` (시스템 관리자).
- No self sign-up, no social login, no external auth service. **The login ID is the user's email** (stored trimmed + lowercase).
- Remote repo: `https://github.com/imorangepie20/acts.git` (branch `main`). Deploy server: `approid@192.168.219.174` (Zorin OS). Public URL: `https://acts.approid.team` via Cloudflare Tunnel — TLS ends at Cloudflare, so production runs with `COOKIE_SECURE=true` and the app is reached through the domain, not plain-HTTP LAN.
- `pnpm build` does not lint; run `pnpm lint` separately. Playwright runs against a production build.
- Host ports (other projects already run on the dev PC and the server): app **3710**, Postgres **5710**, both overridable via `APP_PORT` / `DB_PORT` in `.env`. Inside Docker the app still listens on 3000 and Postgres on 5432. `package.json` `dev` and `start` scripts use `-p 3710`.
- Package manager pnpm. If `pnpm add` reports ignored build scripts for a needed package, add it to `allowBuilds` in `pnpm-workspace.yaml`.

## Review Focus

1. Email typed with different case or surrounding spaces (`" Admin@Approid.Team "`) — must match the stored `admin@approid.team`. → Task 3 test `normalizes email`.
2. Lockout boundary — the 5th consecutive wrong password locks; the correct password while locked is still rejected; after 15 minutes login works and the counter is reset. → Task 3 tests.
3. Deactivating a user or an expired session — the old cookie must stop working on the next request (redirect to `/login`), never render a page or crash. → Task 3 test `rejects session of deactivated user`, Task 4 e2e (logout → redirect).
4. Removing the last active admin (demote or deactivate) — must be refused, or the system becomes unmanageable. → Task 6 test.
5. 사업자등록번호 entered with hyphens/spaces (`220-81-62517`) — accepted and stored as 10 digits; a wrong checksum is rejected with a Korean message. → Task 7 tests.

---

## File Structure

```
.gitignore, .env.example                      # Task 1
docker-compose.yml, docker/postgres/init.sql  # Task 1 (db), Task 8 (app, migrate)
Dockerfile, scripts/backup.sh, docs/deploy.md # Task 8
vitest.config.ts, tests/global-setup.ts, tests/helpers/db.ts   # Task 2
drizzle.config.ts, drizzle/                   # Task 2 (generated migrations)
scripts/migrate.ts, scripts/seed.ts           # Task 2, Task 3
src/server/db/schema.ts        # all tables
src/server/db/client.ts        # createDb(url) — no server-only (tests use it)
src/server/db/index.ts         # server-only singleton `db`
src/lib/permissions.ts         # Role, Permission, ROLE_LABELS, can(), homePathFor() — client-safe
src/server/auth/password.ts    # scrypt hash/verify
src/server/auth/token.ts       # session token generate/hash
src/server/auth/service.ts     # authenticate, createSession, getSessionUser, deleteSession
src/server/auth/dal.ts         # server-only: verifySession, requirePermission
src/proxy.ts                   # optimistic redirect
src/app/(auth)/login/page.tsx, actions.ts     # real login/logout
src/lib/nav.ts                 # accounting menu (replaces demo menu)
src/app/(dashboard)/<phase-1 routes>/page.tsx # placeholders
src/server/users/service.ts, src/app/(dashboard)/admin/users/*     # Task 6
src/lib/business-number.ts, src/server/company/service.ts, src/app/(dashboard)/admin/company/*  # Task 7
e2e/auth.setup.ts, e2e/auth.spec.ts, e2e/admin.spec.ts             # Tasks 4, 6, 7
```

---

### Task 1: Repository hygiene + dev database

**Files:**
- Create: `.gitignore`, `.env.example`, `docker-compose.yml`, `docker/postgres/init.sql`

- [ ] **Step 1: Initialize git** — `git init`. `.gitignore` = standard Next.js entries (`node_modules`, `.next`, `out`, `next-env.d.ts`, `*.tsbuildinfo`, `test-results`, `playwright-report`) plus `.env`, `.env.*` (but `!.env.example`), `SDTPL.txt` (contains a secret), `.superpowers/`, `e2e/.auth/`, `uploads/`, `backups/`.

- [ ] **Step 2: Write `.env.example`** with exactly these keys:

```
POSTGRES_PASSWORD=acts
APP_PORT=3710
DB_PORT=5710
DATABASE_URL=postgres://acts:acts@localhost:5710/acts
DATABASE_URL_TEST=postgres://acts:acts@localhost:5710/acts_test
ADMIN_EMAIL=admin@approid.team
ADMIN_PASSWORD=change-me-now
COOKIE_SECURE=false
```

Copy it to `.env` locally. Change `package.json` scripts to `"dev": "next dev -p 3710"` and `"start": "next start -p 3710"`.

- [ ] **Step 3: `docker-compose.yml` with a `db` service** — image `postgres:17-alpine`, user/db `acts`, password `${POSTGRES_PASSWORD}`, port `127.0.0.1:${DB_PORT:-5710}:5432` (host port from `.env`, never exposed beyond the host), named volume `pgdata`, healthcheck `pg_isready -U acts`, mounts `docker/postgres/init.sql` into `/docker-entrypoint-initdb.d/`. `init.sql`: `CREATE DATABASE acts_test OWNER acts;`

- [ ] **Step 4: Verify** — `docker compose up -d db` then `docker compose exec db psql -U acts -l` lists both `acts` and `acts_test`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: init repo, env template, dev postgres"` (check `git status` first: `SDTPL.txt` and `.env` must NOT be staged). Then `git branch -M main`, `git remote add origin https://github.com/imorangepie20/acts.git`, `git push -u origin main`. Every later task's commit step ends with `git push`.

### Task 2: Drizzle schema, migrations, Vitest harness

**Files:**
- Create: `drizzle.config.ts`, `src/server/db/schema.ts`, `src/server/db/client.ts`, `src/server/db/index.ts`, `scripts/migrate.ts`, `vitest.config.ts`, `tests/global-setup.ts`, `tests/helpers/db.ts`, `src/server/db/schema.test.ts`
- Modify: `package.json` (scripts), `next.config.ts` (nothing yet)

**Interfaces:**
- Produces: `createDb(url: string): Db` (`Db` = drizzle postgres-js instance typed with `schema`), `db: Db` (server-only singleton from `DATABASE_URL`), tables `company`, `users`, `sessions`, enum `userRole`, test helpers `getTestDb(): Db`, `resetDb(db: Db): Promise<void>`.

- [ ] **Step 1: Install** — `pnpm add drizzle-orm postgres zod server-only` and `pnpm add -D drizzle-kit vitest vite-tsconfig-paths tsx`. Check current Drizzle docs (context7) for the postgres-js driver and migrator import paths before writing code.

- [ ] **Step 2: Schema in `src/server/db/schema.ts`:**
  - `userRole` pgEnum `user_role`: `staff | manager | executive | admin`
  - `company`: `id integer pk default 1` with check `id = 1`; `name text not null`; `businessNumber text` (10 digits, nullable until set); `representative text`; `fiscalYearStartMonth integer not null default 1` (check 1–12); `approvalRequired boolean not null default false`; `updatedAt timestamptz not null default now()`
  - `users`: `id uuid pk defaultRandom`; `email text not null unique` (stored trimmed + lowercase; this is the login ID); `name text not null`; `role userRole not null`; `passwordHash text not null`; `isActive boolean not null default true`; `failedLoginCount integer not null default 0`; `lockedUntil timestamptz`; `createdAt`, `updatedAt timestamptz not null default now()`
  - `sessions`: `id text pk` (= SHA-256 hex of token); `userId uuid not null references users(id) on delete cascade`; `expiresAt timestamptz not null`; `createdAt timestamptz not null default now()`; index on `userId`

- [ ] **Step 3: Client + scripts** — `client.ts` exports `createDb`; `index.ts` starts with `import "server-only"` and exports `db = createDb(process.env.DATABASE_URL!)`. `scripts/migrate.ts` runs the Drizzle migrator on `process.env.DATABASE_URL` (load `.env` with `process.loadEnvFile()` when the file exists) and exits. package.json scripts: `"db:generate": "drizzle-kit generate"`, `"db:migrate": "tsx scripts/migrate.ts"`, `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Generate the first migration** — `pnpm db:generate` → a SQL file appears in `drizzle/`. `pnpm db:migrate` → exits 0.

- [ ] **Step 5: Vitest harness** — `vitest.config.ts`: `environment: "node"`, `include: ["src/**/*.test.ts"]`, `globalSetup: "tests/global-setup.ts"`, `fileParallelism: false` (one shared test DB), plugin `vite-tsconfig-paths`. `global-setup.ts` loads `.env` and runs the migrator against `DATABASE_URL_TEST`. `tests/helpers/db.ts`: `getTestDb()` (memoized `createDb(DATABASE_URL_TEST)`), `resetDb(db)` = `TRUNCATE sessions, users, company RESTART IDENTITY CASCADE`. Later plans extend `resetDb`'s table list.

- [ ] **Step 6: Write the failing test `src/server/db/schema.test.ts`**

```ts
test("company table accepts only id 1", async () => {
  const db = getTestDb(); await resetDb(db);
  await db.insert(company).values({ name: "테스트" });
  await expect(db.insert(company).values({ id: 2, name: "x" })).rejects.toThrow();
});
test("email is unique", async () => {
  const db = getTestDb(); await resetDb(db);
  const u = { email: "a@x.kr", name: "A", role: "staff" as const, passwordHash: "x" };
  await db.insert(users).values(u);
  await expect(db.insert(users).values(u)).rejects.toThrow();
});
```

- [ ] **Step 7: Run** — `pnpm test` → both PASS (they fail first only if the schema lacks the check/unique; if they pass immediately, temporarily remove the check to confirm the test bites, then restore).

- [ ] **Step 8: Commit** — `git commit -m "feat(db): drizzle schema for company, users, sessions + vitest harness"`

### Task 3: Passwords, tokens, auth service

**Files:**
- Create: `src/lib/permissions.ts`, `src/server/auth/password.ts`, `src/server/auth/token.ts`, `src/server/auth/service.ts`
- Test: `src/lib/permissions.test.ts`, `src/server/auth/password.test.ts`, `src/server/auth/service.test.ts`

**Interfaces:**
- Consumes: `Db`, `users`, `sessions` (Task 2)
- Produces:
  - `type Role = "staff" | "manager" | "executive" | "admin"`; `type Permission = "overview:view" | "voucher:create" | "voucher:approve" | "ledger:view" | "period:close" | "export:tax" | "settings:manage"`; `ROLE_LABELS: Record<Role, string>` = `{ staff: "실무자", manager: "중간 관리자", executive: "최고 관리자", admin: "시스템 관리자" }`; `can(role: Role, p: Permission): boolean`; `homePathFor(role: Role): string`
  - `hashPassword(plain: string): Promise<string>`; `verifyPassword(plain: string, stored: string): Promise<boolean>`
  - `generateSessionToken(): string` (32 random bytes, base64url); `hashSessionToken(token: string): string` (SHA-256 hex)
  - `type SessionUser = { id: string; email: string; name: string; role: Role }`
  - `authenticate(db, email: string, password: string, now?: Date): Promise<{ ok: true; user: SessionUser } | { ok: false; reason: "invalid" | "locked" }>`
  - `createSession(db, userId: string, now?: Date): Promise<{ token: string; expiresAt: Date }>`
  - `getSessionUser(db, token: string, now?: Date): Promise<SessionUser | null>`
  - `deleteSession(db, token: string): Promise<void>`
  - constants `MAX_FAILED_LOGINS = 5`, `LOCK_MINUTES = 15`, `SESSION_HOURS = 12`

Permission matrix (exact):

| | staff | manager | executive | admin |
|---|---|---|---|---|
| overview:view | | ✓ | ✓ | ✓ |
| voucher:create | ✓ | ✓ | | ✓ |
| voucher:approve | | ✓ | | ✓ |
| ledger:view | ✓ | ✓ | ✓ | ✓ |
| period:close | | | | ✓ |
| export:tax | ✓ | ✓ | | ✓ |
| settings:manage | | | | ✓ |

`homePathFor`: `staff → "/vouchers"`, everyone else `→ "/overview"`.

- [ ] **Step 1: Failing tests**
  - `permissions.test.ts`: assert every cell of the matrix above (table-driven), and `homePathFor("staff") === "/vouchers"`, `homePathFor("executive") === "/overview"`.
  - `password.test.ts`: `verifyPassword("pw-1234", await hashPassword("pw-1234"))` is true; wrong password false; two hashes of the same password differ (random salt).
  - `service.test.ts` (seed one active `staff` user `kim@acts.kr` / `pw-12345678` in `beforeEach` after `resetDb`):
    - `normalizes email`: `authenticate(db, "  Kim@ACTS.kr ", "pw-12345678")` → `ok: true`
    - 4 wrong passwords → `lockedUntil` still null; the 5th wrong attempt returns `"invalid"` and sets `lockedUntil`; the next attempt with the **correct** password returns `"locked"`
    - with `now` = lock time + 16 min, correct password → `ok: true` and `failedLoginCount` is back to 0
    - a successful login resets `failedLoginCount` to 0
    - unknown email → `"invalid"`; inactive user with correct password → `"invalid"`
    - `createSession` then `getSessionUser(token)` returns the user; the DB row id is `hashSessionToken(token)`, never the raw token
    - `getSessionUser` with `now` past `expiresAt` → `null`
    - `rejects session of deactivated user`: set `isActive = false` → `getSessionUser` → `null`
    - `deleteSession` → `getSessionUser` → `null`

- [ ] **Step 2: Run** — `pnpm test` → FAIL (modules missing).

- [ ] **Step 3: Implement.** `hashPassword` uses `crypto.scrypt` (N=16384, r=8, p=1, 16-byte salt, 64-byte key) and stores `scrypt$16384$8$1$<saltB64>$<hashB64>`; `verifyPassword` parses that and compares with `crypto.timingSafeEqual`. `authenticate` trims + lowercases the email; while `lockedUntil > now` it returns `"locked"` without touching the counter; on a wrong password it increments the counter and, on reaching `MAX_FAILED_LOGINS`, sets `lockedUntil = now + LOCK_MINUTES` and resets the counter to 0.

- [ ] **Step 4: Run** — `pnpm test` → all PASS.

- [ ] **Step 5: Seed.** Failing test `src/server/seed.test.ts`: after `resetDb`, calling `seed(db, { email: "admin@acts.kr", password: "pw-12345678" })` (exported from `scripts/seed.ts`) **twice** leaves exactly one `company` row (name `우리회사`) and one `admin`-role user `admin@acts.kr`, and `authenticate` with that password → ok. Implement: insert company if missing; insert admin if no user with that email; never overwrite an existing password. The script's `main` reads `ADMIN_EMAIL` / `ADMIN_PASSWORD` and refuses to run if the email is invalid or the password is shorter than 8. Add `"db:seed": "tsx scripts/seed.ts"`. Run `pnpm test` → PASS; `pnpm db:migrate && pnpm db:seed` → exits 0.

- [ ] **Step 6: Commit** — `git commit -m "feat(auth): scrypt passwords, db sessions, lockout, permission matrix, seed"`

### Task 4: DAL, proxy, real login/logout

**Files:**
- Create: `src/server/auth/dal.ts`, `src/proxy.ts`, `src/app/(auth)/login/actions.ts`, `src/components/layout/user-menu.tsx`, `e2e/auth.setup.ts`
- Modify: `src/app/(auth)/login/page.tsx` (replace demo form), `src/app/page.tsx`, `src/app/(dashboard)/layout.tsx`, `src/components/layout/app-header.tsx`, `playwright.config.ts`
- Test: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: Task 3 service + permissions, `db`
- Produces: `SESSION_COOKIE = "acts_session"`; `verifySession(): Promise<SessionUser>` (React `cache`, redirects to `/login` when missing/invalid); `requirePermission(p: Permission): Promise<SessionUser>` (redirects to `homePathFor(user.role)` when lacking); `loginAction(prev: LoginState, form: FormData): Promise<LoginState>` where `LoginState = { error?: string }`; `logoutAction(): Promise<void>`; `<UserMenu user={SessionUser} />`

- [ ] **Step 1: Read** `node_modules/next/dist/docs/01-app/02-guides/authentication.md` (Database Sessions, DAL, Proxy sections) and `01-getting-started/16-proxy.md`.

- [ ] **Step 2: Failing e2e `e2e/auth.spec.ts`** (runs **without** stored auth: `test.use({ storageState: { cookies: [], origins: [] } })`):
  - visiting `/vouchers` redirects to `/login`
  - wrong password shows `이메일 또는 비밀번호가 올바르지 않습니다.`
  - admin login (`ADMIN_EMAIL` / `ADMIN_PASSWORD` from env) lands on `/overview`
  - after `로그아웃` from the user menu, visiting `/overview` redirects to `/login`

- [ ] **Step 3: Implement.**
  - Cookie options: `httpOnly`, `sameSite: "lax"`, `path: "/"`, `expires` = session expiry, `secure: process.env.COOKIE_SECURE === "true"`.
  - `proxy.ts`: if the request has no `acts_session` cookie and the path is not `/login` (and not `/_next`, static files, `favicon.ico`), redirect to `/login`. Do not redirect logged-in users away from `/login`. No DB access in proxy.
  - Login page: Korean form — 이메일 (`type="email"`), 비밀번호 (keep the show/hide toggle), 로그인 button; remove social buttons, remember-me, sign-up and forgot-password links. Uses `useActionState(loginAction, {})`. Locked message: `로그인 실패가 반복되어 계정이 잠겼습니다. 15분 후 다시 시도하세요.` On success the action redirects to `homePathFor(role)`.
  - `/` page: `verifySession()` then `redirect(homePathFor(user.role))`.
  - Dashboard layout becomes async, calls `verifySession()`, passes `user` to `AppSidebar` and `AppHeader`. Header replaces the static `TB` avatar with `<UserMenu>` (dropdown: name, `ROLE_LABELS[role]`, `로그아웃` form posting `logoutAction`).

- [ ] **Step 4: Playwright auth** — in `playwright.config.ts`: load `.env` (`process.loadEnvFile` if present); add project `setup` (`testMatch: /auth\.setup\.ts/`) whose test logs in as the env admin and saves `e2e/.auth/admin.json`; the `chromium` project gets `dependencies: ["setup"]` and `use.storageState: "e2e/.auth/admin.json"`; `webServer.command` becomes `pnpm db:migrate && pnpm db:seed && pnpm build && pnpm start` (the script already passes `-p 3710`), `webServer.url` and `use.baseURL` become `http://localhost:3710`.

- [ ] **Step 5: Run** — with `docker compose up -d db`: `pnpm exec playwright test e2e/auth.spec.ts e2e/components-button.spec.ts` → PASS (the demo spec proves pages still render behind login).

- [ ] **Step 6: Commit** — `git commit -m "feat(auth): DAL, proxy redirect, Korean login/logout, authenticated e2e"`

### Task 5: Accounting menu, role-filtered navigation, placeholders

**Files:**
- Modify: `src/lib/nav.ts`, `src/components/layout/app-sidebar.tsx`, `src/components/layout/command-palette.tsx`, `src/components/layout/app-header.tsx`, `src/components/placeholder-page.tsx` (Korean copy: `이후 단계에서 구현됩니다.`), `e2e/smoke.spec.ts`
- Create: one `page.tsx` per route below under `src/app/(dashboard)/`, each `await requirePermission(<perm>)` then `<PlaceholderPage title="…" />`

**Interfaces:**
- Consumes: `Permission`, `can`, `requirePermission`, `SessionUser`
- Produces: `NavItem = { title: string; href: string; icon?: LucideIcon; permission: Permission }`; `navGroups: NavGroup[]`; `allNavItems: NavItem[]`; `navGroupsFor(role: Role): NavGroup[]` (drops items the role cannot access and empty groups). Sidebar and command palette take `role` and render `navGroupsFor(role)`. Sidebar brand text becomes `회계 시스템`.

Menu (exact titles, hrefs, permissions):

| Group | Title | href | permission |
|---|---|---|---|
| 경영 현황 | 대시보드 | `/overview` | overview:view |
| 전표 | 전표 입력 | `/vouchers/new` | voucher:create |
| 전표 | 전표 목록 | `/vouchers` | ledger:view |
| 전표 | 자료 불러오기 | `/imports` | voucher:create |
| 장부 | 분개장 | `/ledgers/journal` | ledger:view |
| 장부 | 계정별 원장 | `/ledgers/accounts` | ledger:view |
| 장부 | 거래처별 원장 | `/ledgers/partners` | ledger:view |
| 재무제표 | 합계잔액시산표 | `/reports/trial-balance` | ledger:view |
| 재무제표 | 손익계산서 | `/reports/income-statement` | ledger:view |
| 재무제표 | 재무상태표 | `/reports/balance-sheet` | ledger:view |
| 결산·세무 | 월 마감 | `/closing` | period:close |
| 결산·세무 | 기초잔액·이월 | `/closing/opening` | period:close |
| 결산·세무 | 세무사 자료 | `/exports` | export:tax |
| 설정 | 회사 정보 | `/admin/company` | settings:manage |
| 설정 | 계정과목 | `/admin/accounts` | settings:manage |
| 설정 | 거래처 | `/admin/partners` | settings:manage |
| 설정 | 사업장·부서 | `/admin/sites` | settings:manage |
| 설정 | 사용자 | `/admin/users` | settings:manage |

The demo menu groups are removed from the menu; demo route files stay (spec §6 템플릿 처리) and their e2e specs keep running. Delete the now-unused `authRoutes` export only if nothing imports it.

- [ ] **Step 1: Failing tests**
  - `src/lib/nav.test.ts`: `navGroupsFor("staff")` contains `/vouchers/new` and not `/overview`, `/admin/users`, `/closing`; `navGroupsFor("executive")` contains `/overview`, `/reports/balance-sheet` and not `/vouchers/new`; `navGroupsFor("admin")` flattens to all 18 items.
  - `e2e/smoke.spec.ts`: `/` now redirects to `/overview` (as admin); the theme test uses `/overview`; the command-palette test types `손익` (placeholder text becomes `메뉴 이름을 입력하세요…`) and lands on `/reports/income-statement`; the `allNavItems` loop stays.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test` and `pnpm exec playwright test e2e/smoke.spec.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(nav): Korean accounting menu with role filtering and placeholders"`

### Task 6: User administration

**Files:**
- Create: `src/server/result.ts`, `src/server/users/service.ts`, `src/app/(dashboard)/admin/users/page.tsx`, `src/app/(dashboard)/admin/users/actions.ts`, `src/components/admin/users/*` (table + create/edit dialogs)
- Test: `src/server/users/service.test.ts`, `e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `hashPassword`, `Role`, `ROLE_LABELS`, `requirePermission`
- Produces:
  - `type UserRow = { id: string; email: string; name: string; role: Role; isActive: boolean; lockedUntil: Date | null; createdAt: Date }`
  - `type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }` in `src/server/result.ts` (later plans reuse it)
  - `listUsers(db): Promise<UserRow[]>`; `createUser(db, input: { email: string; name: string; role: Role; password: string }): Promise<Result<UserRow>>`; `updateUser(db, id: string, patch: { name?: string; role?: Role; isActive?: boolean }): Promise<Result>`; `resetPassword(db, id: string, password: string): Promise<Result>`; `unlockUser(db, id: string): Promise<Result>`

Rules and exact Korean errors:
- email: trimmed, lowercased, must be a valid email (zod `email()`) → else `올바른 이메일 주소를 입력하세요.`; duplicate → `이미 사용 중인 이메일입니다.`
- password at least 8 chars → else `비밀번호는 8자 이상이어야 합니다.`
- name required (trimmed) → `이름을 입력하세요.`
- demoting or deactivating the last active admin → `활성 시스템 관리자가 최소 1명 있어야 합니다.`
- deactivation and password reset delete that user's sessions; `unlockUser` clears `lockedUntil` and `failedLoginCount`.

- [ ] **Step 1: Failing service tests** — one per rule above (exact error strings), plus: `deactivating a user deletes their sessions` (create session → deactivate → `getSessionUser` null); `listUsers` never exposes `passwordHash` (assert key absent).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement service**, then the page: TanStack table (columns 이메일, 이름, 역할, 상태 [`사용`/`중지`/`잠김`], 생성일) with row actions 수정 · 비밀번호 초기화 · 잠금 해제; `사용자 추가` dialog. Server Actions call `requirePermission("settings:manage")` first, then the service, then `revalidatePath("/admin/users")`; errors render under the form via `useActionState`.
- [ ] **Step 4: e2e `e2e/admin.spec.ts`** — admin creates staff `e2e-staff-<timestamp>`, logs out, logs in as that staff → lands on `/vouchers`; sidebar has no `설정` group; direct visit to `/admin/users` redirects to `/vouchers`.
- [ ] **Step 5: Run** `pnpm test` + `pnpm exec playwright test e2e/admin.spec.ts` → PASS. **Step 6: Commit** — `git commit -m "feat(admin): user management with roles, lockout reset, last-admin guard"`

### Task 7: Company settings

**Files:**
- Create: `src/lib/business-number.ts`, `src/server/company/service.ts`, `src/app/(dashboard)/admin/company/actions.ts`, `src/components/admin/company-form.tsx`
- Modify: `src/app/(dashboard)/admin/company/page.tsx` (placeholder from Task 5 replaced)
- Test: `src/lib/business-number.test.ts`, `src/server/company/service.test.ts`, add a case to `e2e/admin.spec.ts`

**Interfaces:**
- Produces: `normalizeBusinessNumber(input: string): string` (digits only); `isValidBusinessNumber(digits: string): boolean`; `formatBusinessNumber(digits: string): string` (`220-81-62517`); `type Company = { name: string; businessNumber: string | null; representative: string | null; fiscalYearStartMonth: number; approvalRequired: boolean }`; `getCompany(db): Promise<Company>`; `updateCompany(db, input: Company): Promise<Result>`. 1B reads `approvalRequired` via `getCompany`.

Checksum (exact): digits `d0..d9`, weights `[1,3,7,1,3,7,1,3,5]`; `sum = Σ d_i·w_i (i=0..8) + floor(d8·5/10)`; valid iff `(10 − sum mod 10) mod 10 === d9`.

- [ ] **Step 1: Failing tests** — `isValidBusinessNumber("2208162517")` true, `"2208162518"` false, `"12345"` false; `normalizeBusinessNumber(" 220-81 62517 ")` → `"2208162517"`; `formatBusinessNumber("2208162517")` → `"220-81-62517"`. Service: invalid checksum → `사업자등록번호가 올바르지 않습니다.`; empty name → `회사명을 입력하세요.`; month 13 → `회계연도 시작 월은 1~12 사이여야 합니다.`; valid update round-trips through `getCompany` (businessNumber stored as 10 digits); empty businessNumber stores `null`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** service + form (회사명, 사업자등록번호, 대표자, 회계연도 시작 월 select 1~12월, `전표 승인 사용` switch with helper text `켜면 승인된 전표만 장부와 대시보드에 반영됩니다.`), Server Action guarded by `settings:manage`, toast `저장되었습니다.` on success.
- [ ] **Step 4: e2e** — admin saves `220-81-62517`, reloads, field shows `220-81-62517`.
- [ ] **Step 5: Run** all tests → PASS. **Step 6: Commit** — `git commit -m "feat(admin): company settings with business-number validation and approval toggle"`

### Task 8: Docker deployment, Cloudflare Tunnel, backup

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `scripts/backup.sh`, `docs/deploy.md`
- Modify: `next.config.ts` (`output: "standalone"`), `docker-compose.yml` (add `migrate`, `app`, `cloudflared`), `.env.example` (add `CLOUDFLARE_TUNNEL_TOKEN=`), `README.md` (replace template description with this project + link to `docs/deploy.md`), `CLAUDE.md` (add DB/test/deploy commands; dev URL becomes `http://localhost:3710`)

**Interfaces:**
- Produces: `docker compose up -d` brings up `db` → `migrate` (runs `pnpm db:migrate && pnpm db:seed`, exits) → `app` (container port 3000, host port `127.0.0.1:${APP_PORT:-3710}`) → `cloudflared` (publishes `app:3000` as `https://acts.approid.team`). Dev machines run only `docker compose up -d db`; put `migrate`, `app`, `cloudflared` under compose profile `prod` so `docker compose --profile prod up -d` is the server command.

**Needs from the user (stop and ask if missing):** a Cloudflare Tunnel created in the Cloudflare Zero Trust dashboard with public hostname `acts.approid.team` → service `http://app:3000`, and its token. The token goes only into the server's `.env`, never into git.

- [ ] **Step 1: Dockerfile** — multi-stage on `node:24-alpine` with corepack pnpm: `deps` (install from lockfile), `builder` (copies source, `pnpm build`; this stage is also the `migrate` service's image), `runner` (copies `.next/standalone`, `.next/static`, `public`; non-root user; `CMD ["node", "server.js"]`; `HOSTNAME=0.0.0.0`, `PORT=3000`).
- [ ] **Step 2: Compose** — `migrate`: `build.target: builder`, env `DATABASE_URL` pointing at host `db`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `depends_on: db: condition: service_healthy`. `app`: `build.target: runner`, env `DATABASE_URL`, `COOKIE_SECURE`, `depends_on: migrate: condition: service_completed_successfully`, `restart: unless-stopped`, port `127.0.0.1:${APP_PORT:-3710}:3000`, volume `uploads:/app/uploads` (used from 1B). `cloudflared`: image `cloudflare/cloudflared` pinned to a specific release tag (not `latest`), `command: tunnel --no-autoupdate run`, env `TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}`, `depends_on: app`, `restart: unless-stopped`. `db` gets `restart: unless-stopped`.
- [ ] **Step 3: `scripts/backup.sh` + `docs/deploy.md`** — backup: `docker compose exec -T db pg_dump -U acts -Fc acts > backups/acts-$(date +%F-%H%M).dump`, then delete dumps older than 30 days. `docs/deploy.md` (Korean): server `approid@192.168.219.174` prerequisites (Docker Engine + compose plugin on Zorin OS), first install (`git clone https://github.com/imorangepie20/acts.git ~/acts`, create `.env` from `.env.example` with strong `ADMIN_PASSWORD` / `POSTGRES_PASSWORD`, `COOKIE_SECURE=true`, `CLOUDFLARE_TUNNEL_TOKEN`), `docker compose --profile prod up -d --build`, updating (`git pull && docker compose --profile prod up -d --build`), Cloudflare Tunnel hostname setup, daily cron line for `backup.sh`, restore with `pg_restore`. Note that the site is internet-facing; recommend putting a Cloudflare Access policy (allowed emails) in front of `acts.approid.team` as an extra gate (dashboard config, no code).
- [ ] **Step 4: Verify locally** — `docker compose --profile prod up -d --build` with `COOKIE_SECURE=false` and no tunnel token (stop `cloudflared` if it restarts in a loop); `curl -I http://localhost:3710/login` → `200`; log in as the env admin; `bash scripts/backup.sh` creates a non-empty file in `backups/`. Then `docker compose --profile prod down`.
- [ ] **Step 5: Full regression** — `pnpm lint`, `pnpm test`, `pnpm test:e2e` all pass.
- [ ] **Step 6: Commit + push** — `git commit -m "feat(deploy): docker compose stack, cloudflare tunnel, backup script, deploy guide" && git push`
- [ ] **Step 7: Deploy to the server (confirm with the user before running)** — over `ssh approid@192.168.219.174`, first check the host ports are free (`ss -ltn | grep -E ":(3710|5710) "` prints nothing; if taken, set other values for `APP_PORT` / `DB_PORT` in the server `.env`), then follow `docs/deploy.md` first-install steps. Verify: `curl -I https://acts.approid.team/login` → `200`; logging in through the domain works (secure cookie set, Server Action login succeeds — if Next rejects the action's origin, add `acts.approid.team` to `experimental.serverActions.allowedOrigins` per the Next 16 docs); the crontab has the backup line.
