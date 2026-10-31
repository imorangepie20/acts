import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { TotpSetupForm } from "@/components/auth/totp-setup-form";
import { homePathFor } from "@/lib/permissions";
import { verifyPartialSession } from "@/server/auth/dal";
import { startEnrolment } from "@/server/auth/mfa";
import { db } from "@/server/db";

export default async function TotpSetupPage() {
  const user = await verifyPartialSession();
  if (user.mfa === "pending") redirect("/2fa/verify");
  if (user.mfa === "verified") redirect(homePathFor(user.role));

  const { secret, otpauth } = await startEnrolment(db, user.id);
  const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 200 });
  return <TotpSetupForm qr={qr} secret={secret} homePath={homePathFor(user.role)} />;
}
