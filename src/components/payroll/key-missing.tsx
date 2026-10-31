import { Alert, AlertDescription } from "@/components/ui/alert";
import { ENCRYPTION_KEY_MISSING_PAGE } from "@/server/auth/mfa";

export function KeyMissingAlert() {
  return (
    <Alert variant="destructive">
      <AlertDescription>{ENCRYPTION_KEY_MISSING_PAGE}</AlertDescription>
    </Alert>
  );
}
