"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AccountPicker, type AccountOption } from "@/components/vouchers/account-picker";

/** Searchable account select; choosing one navigates with `account=<id>`, keeping the other filters. */
export function AccountSelect({ accounts, value }: { accounts: AccountOption[]; value: number | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="flex w-64 flex-col gap-1.5">
      <span className="text-sm font-medium">계정과목</span>
      <AccountPicker
        label="계정과목"
        accounts={accounts}
        value={value}
        onChange={(id) => {
          const q = new URLSearchParams(params.toString());
          q.set("account", String(id));
          q.delete("partner"); // a partner belongs to one account
          q.delete("page"); // the old page number is meaningless for another ledger
          router.push(`${pathname}?${q.toString()}`);
        }}
      />
    </div>
  );
}
