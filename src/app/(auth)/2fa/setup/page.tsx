import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { TotpConfigError } from "@/components/auth/totp-config-error";
import { TotpSetupForm } from "@/components/auth/totp-setup-form";
import { homePathFor } from "@/lib/permissions";
import { verifyPartialSession } from "@/server/auth/dal";
import { isTotpEnabled, startEnrolment, withEncryptionKey } from "@/server/auth/mfa";
import { db } from "@/server/db";

export default async function TotpSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ voluntary?: string | string[] }>;
}) {
  const user = await verifyPartialSession();
  // ?voluntary=1 comes from the profile page: a role that does not require TOTP may still enrol.
  const voluntary = (await searchParams).voluntary === "1";
  if (user.mfa === "pending") redirect("/2fa/verify");
  if (user.mfa === "verified" && (!voluntary || (await isTotpEnabled(db, user.id)))) {
    redirect(voluntary ? "/profile" : homePathFor(user.role));
  }

  const r = await withEncryptionKey(() => startEnrolment(db, user.id));
  if (!r.ok) return <TotpConfigError message={r.error} />;
  const { secret, otpauth } = r.value;
  const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 200 });
  return (
    <TotpSetupForm
      qr={qr}
      secret={secret}
      voluntary={voluntary}
      nextPath={voluntary ? "/profile" : homePathFor(user.role)}
    />
  );
}
