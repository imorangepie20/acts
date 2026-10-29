import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/permissions";
import { verifySession } from "@/server/auth/dal";

export default async function RootPage() {
  const user = await verifySession();
  redirect(homePathFor(user.role));
}
