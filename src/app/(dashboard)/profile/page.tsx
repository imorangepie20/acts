import { TwoFactorSection } from "@/components/auth/two-factor-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/permissions";
import { verifySession } from "@/server/auth/dal";
import { isTotpEnabled, mfaRequired } from "@/server/auth/mfa";
import { db } from "@/server/db";

export default async function ProfilePage() {
  const user = await verifySession();
  const enabled = await isTotpEnabled(db, user.id);
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">내 정보</h1>
      <Card>
        <CardHeader>
          <CardTitle>계정</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">이름</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">이메일</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">권한</dt>
            <dd>{ROLE_LABELS[user.role]}</dd>
          </dl>
        </CardContent>
      </Card>
      <TwoFactorSection enabled={enabled} required={mfaRequired(user.role)} />
    </div>
  );
}
