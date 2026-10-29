import { PlaceholderPage } from "@/components/placeholder-page";
import { requirePermission } from "@/server/auth/dal";

export default async function Page() {
  await requirePermission("ledger:view");
  return <PlaceholderPage title="합계잔액시산표" />;
}
