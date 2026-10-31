"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ACCOUNT_GROUP_LABELS, type AccountGroup } from "@/lib/accounts";
import { cn } from "@/lib/utils";

export type AccountOption = { id: number; code: string; name: string; group: AccountGroup };

type Props = {
  /** Accessible name (the field label). */
  label: string;
  id?: string;
  accounts: AccountOption[];
  /** Groups to offer; all when omitted. */
  groups?: readonly AccountGroup[];
  /** Codes listed first, in this order. */
  first?: readonly string[];
  value: number | null;
  onChange: (id: number) => void;
  className?: string;
};

const NONE: readonly string[] = [];

/** Account combobox: type a code or a name, Enter picks the highlighted account. */
export function AccountPicker({ label, id, accounts, groups, first = NONE, value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find((a) => a.id === value);

  const { pinned, byGroup } = useMemo(() => {
    const allowed = accounts.filter((a) => !groups || groups.includes(a.group));
    const pinned = first
      .map((code) => accounts.find((a) => a.code === code))
      .filter((a): a is AccountOption => a !== undefined);
    const pinnedIds = new Set(pinned.map((a) => a.id));
    const byGroup = new Map<AccountGroup, AccountOption[]>();
    for (const a of allowed) {
      if (pinnedIds.has(a.id)) continue;
      byGroup.set(a.group, [...(byGroup.get(a.group) ?? []), a]);
    }
    return { pinned, byGroup };
  }, [accounts, groups, first]);

  const item = (a: AccountOption) => (
    <CommandItem
      key={a.id}
      value={`${a.code} ${a.name}`}
      data-checked={a.id === value}
      onSelect={() => {
        onChange(a.id);
        setOpen(false);
      }}
    >
      <span className="w-9 tabular-nums text-muted-foreground">{a.code}</span>
      {a.name}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
          />
        }
      >
        <span className="truncate">{selected ? `${selected.code} ${selected.name}` : "계정 선택"}</span>
        <ChevronsUpDownIcon className="size-4 opacity-50" />
      </PopoverTrigger>
      {/* fixed: cmdk scrolls its first item into view before the popup is positioned, which would scroll the page */}
      <PopoverContent className="w-72 p-0" align="start" positionMethod="fixed">
        <Command>
          <CommandInput placeholder="코드 또는 이름으로 검색" />
          <CommandList>
            <CommandEmpty>계정이 없습니다.</CommandEmpty>
            {pinned.length > 0 && <CommandGroup heading="자주 쓰는 계정">{pinned.map(item)}</CommandGroup>}
            {[...byGroup].map(([g, list]) => (
              <CommandGroup key={g} heading={ACCOUNT_GROUP_LABELS[g]}>
                {list.map(item)}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
