import { logoutAction } from "@/app/(auth)/login/actions"
import { AuthCard } from "@/components/auth/auth-card"

/** Shown instead of a 500 when the server cannot use its encryption key. */
export function TotpConfigError({ message }: { message: string }) {
  return (
    <AuthCard
      title="2단계 인증"
      footer={
        <form action={logoutAction}>
          <button type="submit" className="text-muted-foreground underline-offset-4 hover:underline">
            다른 계정으로 로그인
          </button>
        </form>
      }
    >
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
    </AuthCard>
  )
}
