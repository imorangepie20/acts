import { Alert, AlertDescription } from "@/components/ui/alert";
import { ENCRYPTION_KEY_MISSING_PAGE } from "@/server/auth/mfa";

export function KeyMissingAlert({ message = ENCRYPTION_KEY_MISSING_PAGE }: { message?: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
