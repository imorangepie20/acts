import { redirect } from "next/navigation";
import { TotpVerifyForm } from "@/components/auth/totp-verify-form";
import { homePathFor } from "@/lib/permissions";
import { verifyPartialSession } from "@/server/auth/dal";

export default async function TotpVerifyPage() {
  const user = await verifyPartialSession();
  if (user.mfa === "unenrolled") redirect("/2fa/setup");
  if (user.mfa === "verified") redirect(homePathFor(user.role));
  return <TotpVerifyForm />;
}
