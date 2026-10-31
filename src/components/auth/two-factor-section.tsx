"use client"

import { useActionState, useState } from "react"
import Link from "next/link"

import { disableTotpAction, type DisableTotpState } from "@/app/(dashboard)/profile/actions"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Profile card: 2단계 인증 status; optional roles can turn it on or (with a code) off. */
export function TwoFactorSection({ enabled, required }: { enabled: boolean; required: boolean }) {
  const [state, formAction, pending] = useActionState<DisableTotpState, FormData>(disableTotpAction, {})
  const [turningOff, setTurningOff] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          2단계 인증
          <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "사용 중" : "사용 안 함"}</Badge>
        </CardTitle>
        <CardDescription>
          {required
            ? "이 역할은 2단계 인증을 반드시 써야 하므로 끌 수 없습니다."
            : "로그인할 때 비밀번호와 함께 인증 앱의 6자리 코드를 입력합니다."}
        </CardDescription>
      </CardHeader>
      {!required && (
        <CardContent>
          {!enabled && (
            <Link href="/2fa/setup?voluntary=1" className={buttonVariants()}>
              2단계 인증 사용
            </Link>
          )}
          {enabled && !turningOff && (
            <Button variant="outline" onClick={() => setTurningOff(true)}>
              2단계 인증 끄기
            </Button>
          )}
          {enabled && turningOff && (
            <form key={state.nonce} action={formAction} className="flex max-w-xs flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="disable-code">인증 코드</Label>
                <Input
                  id="disable-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
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
              <div className="flex gap-2">
                <Button type="submit" variant="destructive" disabled={pending}>
                  끄기
                </Button>
                <Button type="button" variant="ghost" onClick={() => setTurningOff(false)}>
                  취소
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      )}
    </Card>
  )
}
