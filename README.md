# acts

한국 회계 시스템 (Phase 1A: 기반, 인증, 관리자 기능). Next.js 16 + React 19 + Tailwind v4 + shadcn/ui (Base UI) + Postgres (Drizzle).

## 개발

```bash
cp .env.example .env
docker compose up -d db   # Postgres (localhost:5710)
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                  # http://localhost:3710
```

```bash
pnpm lint       # eslint
pnpm test       # vitest
pnpm test:e2e   # Playwright (production build 기준)
```

## 배포

Docker Compose + Cloudflare Tunnel 로 `https://acts.approid.team` 에 배포합니다. 자세한 절차는 [docs/deploy.md](docs/deploy.md) 를 참고하세요.
