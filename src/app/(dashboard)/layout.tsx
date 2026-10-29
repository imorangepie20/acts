import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { verifySession } from "@/server/auth/dal";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>
        <AppHeader user={user} />
        <main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
