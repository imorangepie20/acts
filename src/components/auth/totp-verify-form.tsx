"use client"

import { useActionState } from "react"

import { verifyTotpAction, type TotpVerifyState } from "@/app/(auth)/2fa/actions"
import { logoutAction } from "@/app/(auth)/login/actions"
import { AuthCard } from "@/components/auth/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function TotpVerifyForm() {
  const [state, formAction, pending] = useActionState<TotpVerifyState, FormData>(verifyTotpAction, {})

  return (
    <AuthCard
      title="2단계 인증"
      description="인증 앱에 표시된 6자리 코드를 입력하세요. 휴대폰이 없으면 복구 코드를 입력할 수 있습니다."
      footer={
        <form action={logoutAction}>
          <button type="submit" className="text-muted-foreground underline-offset-4 hover:underline">
            다른 계정으로 로그인
          </button>
        </form>
      }
    >
      <form key={state.nonce} action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">인증 코드</Label>
          <Input id="code" name="code" autoComplete="one-time-code" maxLength={16} required autoFocus />
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
    </AuthCard>
  )
}
