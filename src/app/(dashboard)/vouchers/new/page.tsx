import { PlaceholderPage } from "@/components/placeholder-page";
import { requirePermission } from "@/server/auth/dal";

export default async function Page() {
  await requirePermission("voucher:create");
  return <PlaceholderPage title="전표 입력" />;
}
