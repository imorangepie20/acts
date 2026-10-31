import { redirect } from "next/navigation";
import { TotpConfigError } from "@/components/auth/totp-config-error";
import { TotpVerifyForm } from "@/components/auth/totp-verify-form";
import { homePathFor } from "@/lib/permissions";
import { verifyPartialSession } from "@/server/auth/dal";
import { withEncryptionKey } from "@/server/auth/mfa";
import { assertEncryptionKey } from "@/server/crypto/secret";

export default async function TotpVerifyPage() {
  const user = await verifyPartialSession();
  if (user.mfa === "unenrolled") redirect("/2fa/setup");
  if (user.mfa === "verified") redirect(homePathFor(user.role));
  const key = await withEncryptionKey(async () => assertEncryptionKey());
  if (!key.ok) return <TotpConfigError message={key.error} />;
  return <TotpVerifyForm />;
}
