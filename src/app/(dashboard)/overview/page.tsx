import { PlaceholderPage } from "@/components/placeholder-page";
import { requirePermission } from "@/server/auth/dal";

export default async function Page() {
  await requirePermission("overview:view");
  return <PlaceholderPage title="대시보드" />;
}
