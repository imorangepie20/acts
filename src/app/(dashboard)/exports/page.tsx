import { PlaceholderPage } from "@/components/placeholder-page";
import { requirePermission } from "@/server/auth/dal";

export default async function Page() {
  await requirePermission("export:tax");
  return <PlaceholderPage title="세무사 자료" />;
}
