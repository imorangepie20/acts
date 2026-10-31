import { TwoFactorSection } from "@/components/auth/two-factor-section";
import { ProfileV1 } from "@/components/pages/profile/profile-v1";
import { verifySession } from "@/server/auth/dal";
import { isTotpEnabled, mfaRequired } from "@/server/auth/mfa";
import { db } from "@/server/db";

export default async function ProfileV1Page() {
  const user = await verifySession();
  const enabled = await isTotpEnabled(db, user.id);
  return (
    <div className="flex flex-col gap-6 p-6">
      <TwoFactorSection enabled={enabled} required={mfaRequired(user.role)} />
      <ProfileV1 />
    </div>
  );
}
