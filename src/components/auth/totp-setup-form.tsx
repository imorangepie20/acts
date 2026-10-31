"use client"

import { useActionState } from "react"
import Link from "next/link"

import { confirmTotpSetupAction, type TotpSetupState } from "@/app/(auth)/2fa/actions"
import { logoutAction } from "@/app/(auth)/login/actions"
import { AuthCard } from "@/components/auth/auth-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim()
}

export function TotpSetupForm({ qr, secret, homePath }: { qr: string; secret: string; homePath: string }) {
  const [state, formAction, pending] = useActionState<TotpSetupState, FormData>(confirmTotpSetupAction, {})

  if (state.recoveryCodes) {
    return (
      <AuthCard
        title="복구 코드"
        description="휴대폰을 잃어버렸을 때 인증 코드 대신 쓸 수 있습니다. 각 코드는 한 번만 쓸 수 있고, 이 화면에서만 볼 수 있습니다. 안전한 곳에 적어 두세요."
      >
        <div className="flex flex-col gap-4">
          <ul
            aria-label="복구 코드"
            className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm"
          >
            {state.recoveryCodes.map((c) => (
              <li key={c} className="text-center">
                {c}
              </li>
            ))}
          </ul>
          <Link href={homePath} className={cn(buttonVariants(), "w-full")}>
            다음
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="2단계 인증 등록"
      description="이 계정은 2단계 인증을 써야 합니다. 인증 앱(Google Authenticator 등)으로 QR 코드를 찍은 뒤 앱에 표시된 6자리 코드를 입력하세요."
      footer={
        <form action={logoutAction}>
          <button type="submit" className="text-muted-foreground underline-offset-4 hover:underline">
            다른 계정으로 로그인
          </button>
        </form>
      }
    >
      <div className="flex flex-col gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, nothing to optimize */}
        <img src={qr} alt="인증 앱 등록용 QR 코드" width={200} height={200} className="mx-auto rounded-md border" />
        <div className="flex flex-col gap-1 text-center text-sm">
          <span className="text-muted-foreground">QR 코드를 찍을 수 없으면 이 키를 직접 입력하세요.</span>
          <code data-testid="totp-secret" data-secret={secret} className="font-mono text-sm break-all select-all">
            {groupKey(secret)}
          </code>
        </div>
        <form key={state.nonce} action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">인증 코드</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
            />
          </div>
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            확인
          </Button>
        </form>
      </div>
    </AuthCard>
  )
}
