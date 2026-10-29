# 배포 가이드

구성: `db`(Postgres 17) → `migrate`(마이그레이션 + 관리자 시드, 실행 후 종료) → `app`(Next.js standalone, 컨테이너 포트 3000) → `cloudflared`(Cloudflare Tunnel, `https://acts.approid.team` 로 공개).
`migrate`, `app`, `cloudflared` 는 compose 프로필 `prod` 에 속합니다. 개발 PC 에서는 `docker compose up -d db` 만 실행합니다.

> 이 사이트는 인터넷에 공개됩니다. **최초 `docker compose --profile prod up` 전에** 아래 "Cloudflare Access" 절(7)의 접근 정책을 먼저 설정하세요. 이메일만 알면 누구나 로그인 실패를 반복해 계정을 15분씩 반복 잠글 수 있기 때문입니다.

## 1. 서버 준비 (`approid@192.168.219.174`, Zorin OS)

- Docker Engine + compose 플러그인 설치 (`docker compose version` 이 동작해야 함).
- 사용자가 docker 그룹에 속해 있어야 함 (`sudo usermod -aG docker approid` 후 재로그인).
- 호스트 포트 확인: `ss -ltn | grep -E ":(3710|5710) "` 결과가 비어 있어야 합니다. 사용 중이면 `.env` 의 `APP_PORT` / `DB_PORT` 를 다른 값으로 바꿉니다.

## 2. Cloudflare Tunnel 설정

1. Cloudflare Zero Trust 대시보드 > Networks > Tunnels 에서 터널 생성 (Cloudflared 유형).
2. Public hostname: `acts.approid.team` → Service `HTTP` / `http://app:3000`.
3. 터널 토큰을 복사해 서버의 `.env` 에만 넣습니다. 토큰은 절대 git 에 커밋하지 않습니다.

## 3. 최초 설치

```bash
ssh approid@192.168.219.174
git clone https://github.com/imorangepie20/acts.git ~/acts
cd ~/acts
mkdir -p backups
cp .env.example .env
nano .env
```

`.env` 에서 설정할 값:

| 키 | 값 |
| --- | --- |
| `POSTGRES_PASSWORD` | 강한 임의 비밀번호 |
| `ADMIN_EMAIL` | 초기 시스템 관리자 이메일 |
| `ADMIN_PASSWORD` | 강한 임의 비밀번호 (8자 이상, `change-me-now` 불가). **최초 시드 때만** 사용되며 이후 바꿔도 반영되지 않습니다 (변경은 9절의 재설정 스크립트) |
| `COOKIE_SECURE` | 설정하지 않음 (compose 기본값 `true`). 로컬 dev/e2e 에서만 `false` |
| `CLOUDFLARE_TUNNEL_TOKEN` | 2단계에서 복사한 토큰 |

`DATABASE_URL` 은 compose 가 컨테이너 안에서 `db:5432` 로 직접 지정하므로 서버 `.env` 에서는 쓰이지 않습니다.

먼저 7절(Cloudflare Access)의 접근 정책이 적용되어 있는지 확인한 뒤 실행합니다.

```bash
docker compose --profile prod up -d --build
docker compose --profile prod ps
curl -I https://acts.approid.team/login   # 200
```

## 4. 업데이트

```bash
cd ~/acts
git pull && docker compose --profile prod up -d --build
```

`migrate` 가 매번 마이그레이션을 적용한 뒤 `app` 이 시작됩니다.

## 5. 백업

`scripts/backup.sh` 는 `backups/acts-YYYY-MM-DD-HHMM.dump` (pg_dump custom 형식)를 만들고 30일 지난 파일을 삭제합니다.

매일 새벽 3시 cron (`crontab -e`):

```cron
0 3 * * * cd /home/approid/acts && mkdir -p backups && bash scripts/backup.sh >> backups/backup.log 2>&1
```

백업 파일은 같은 서버에 있으므로 주기적으로 다른 장비로도 복사해 두세요.

## 6. 복구

```bash
cd ~/acts
docker compose --profile prod stop app
docker compose exec -T db pg_restore -U acts -d acts --clean --if-exists --no-owner < backups/acts-2026-01-01-0300.dump
docker compose --profile prod up -d
```

## 7. Cloudflare Access (최초 배포 전 설정 강력 권장)

공개 도메인 앞에 추가 관문을 둡니다 (코드 변경 없음). 로그인 5회 실패 시 해당 계정이 15분 잠기므로, 관문이 없으면 이메일 주소만 아는 제3자가 관리자 계정을 반복해서 잠글 수 있습니다. Zero Trust > Access > Applications > Add an application > Self-hosted, 도메인 `acts.approid.team`, 정책은 허용 이메일 목록(Allow, Emails)으로 설정합니다.

## 8. 계정 복구

계정 잠금 해제 (서버에서):

```bash
cd ~/acts
docker compose exec db psql -U acts -c "update users set locked_until = null, failed_login_count = 0 where email = '<email>';"
```

## 9. 관리자 비밀번호 재설정

비밀번호를 잊었거나 `.env` 의 `ADMIN_PASSWORD` 를 바꾸고 싶을 때(시드는 최초 1회만 적용됨). 새 비밀번호를 해시해 저장하고, 잠금/실패 횟수를 초기화하며, 해당 사용자의 세션을 모두 삭제합니다. `migrate` 서비스 이미지(tsx 포함)로 실행합니다.

```bash
cd ~/acts
docker compose --profile prod run --rm -e NEW_PASSWORD='새-비밀번호-8자이상' migrate pnpm admin:reset-password <email>
```

## 10. 문제 해결

- 로그인 시 Server Action 이 거부되면(리버스 프록시의 Origin/Host 불일치) `next.config.ts` 에 다음을 추가하고 다시 빌드합니다. 실서버에 처음 배포할 때 도메인으로 로그인해 보며 확인하세요.

  ```ts
  experimental: { serverActions: { allowedOrigins: ["acts.approid.team"] } },
  ```
- 로그인 쿠키는 `COOKIE_SECURE=true` 일 때 secure 로 발급되므로 반드시 도메인(HTTPS)으로 접속해야 합니다. LAN 의 HTTP 주소로는 로그인 상태가 유지되지 않습니다.
- 로그: `docker compose --profile prod logs -f app` (또는 `cloudflared`, `migrate`).
- 로컬에서 prod 스택 점검 시 `.env` 에 `COOKIE_SECURE=false`, 터널 토큰 없이 `docker compose --profile prod up -d --build` 후 `docker compose --profile prod stop cloudflared`.
