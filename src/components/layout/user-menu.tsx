import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/login/actions";
import { ROLE_LABELS } from "@/lib/permissions";
import type { SessionUser } from "@/server/auth/service";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ user }: { user: SessionUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="사용자 메뉴"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar className="size-8">
          <AvatarFallback>{user.name.slice(0, 2)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <div className="px-1.5 py-1.5">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
        </div>
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <DropdownMenuItem render={<button type="submit" className="w-full" />}>
            <LogOut />
            로그아웃
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
