import { PlaceholderPage } from "@/components/placeholder-page";
import { requirePermission } from "@/server/auth/dal";

export default async function Page() {
  await requirePermission("period:close");
  return <PlaceholderPage title="기초잔액·이월" />;
}
