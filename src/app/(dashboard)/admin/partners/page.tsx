import { PlaceholderPage } from "@/components/placeholder-page";
import { requirePermission } from "@/server/auth/dal";

export default async function Page() {
  await requirePermission("settings:manage");
  return <PlaceholderPage title="거래처" />;
}
