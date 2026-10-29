"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatBusinessNumber } from "@/lib/business-number";
import { cn } from "@/lib/utils";
import { quickCreatePartnerAction } from "@/app/(dashboard)/admin/partners/actions";
import { searchPartnersAction, type PartnerOption } from "@/app/(dashboard)/vouchers/actions";

export type PartnerValue = { id: number; name: string } | null;

type Props = {
  label: string;
  id?: string;
  value: PartnerValue;
  onChange: (p: PartnerValue) => void;
  className?: string;
};

/** Partner combobox with server search and inline 새 거래처 추가. */
export function PartnerPicker({ label, id, value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PartnerOption[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(async () => {
      const rows = await searchPartnersAction(q);
      if (live) setResults(rows);
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open]);

  const choose = (p: PartnerValue) => {
    onChange(p);
    setOpen(false);
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setQ("");
        }}
      >
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              role="combobox"
              aria-label={label}
              aria-expanded={open}
              className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
            />
          }
        >
          <span className="truncate">{value ? value.name : "거래처 없음"}</span>
          <ChevronsUpDownIcon className="size-4 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="거래처명 또는 사업자등록번호" value={q} onValueChange={setQ} autoFocus />
            <CommandList>
              <CommandGroup>
                {results.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`p-${p.id}`}
                    data-checked={p.id === value?.id}
                    onSelect={() => choose({ id: p.id, name: p.name })}
                  >
                    <span className="truncate">{p.name}</span>
                    {p.businessNumber && (
                      <span className="text-xs text-muted-foreground">{formatBusinessNumber(p.businessNumber)}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup>
                {value && (
                  <CommandItem value="__none" onSelect={() => choose(null)}>
                    거래처 지우기
                  </CommandItem>
                )}
                <CommandItem
                  value="__new"
                  onSelect={() => {
                    setOpen(false);
                    setAdding(true);
                  }}
                >
                  <PlusIcon />
                  새 거래처 추가{q.trim() && `: ${q.trim()}`}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <QuickPartnerDialog
        open={adding}
        initialName={q.trim()}
        onClose={() => setAdding(false)}
        onCreated={(p) => {
          setAdding(false);
          onChange(p);
        }}
      />
    </>
  );
}

function QuickPartnerDialog({
  open,
  initialName,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onCreated: (p: { id: number; name: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 거래처 추가</DialogTitle>
        </DialogHeader>
        {open && <QuickPartnerForm initialName={initialName} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function QuickPartnerForm({
  initialName,
  onCreated,
}: {
  initialName: string;
  onCreated: (p: { id: number; name: string }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [businessNumber, setBusinessNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        // Keep the voucher form untouched: this form sits in a portal but React events bubble.
        e.stopPropagation();
        startTransition(async () => {
          const r = await quickCreatePartnerAction({ name, businessNumber });
          if (r.ok) onCreated({ id: r.value.id, name: r.value.name });
          else setError(r.error);
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quick-partner-name">거래처명</Label>
        <Input id="quick-partner-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quick-partner-bn">사업자등록번호</Label>
        <Input
          id="quick-partner-bn"
          inputMode="numeric"
          placeholder="000-00-00000 (선택)"
          autoComplete="off"
          value={businessNumber}
          onChange={(e) => setBusinessNumber(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        추가
      </Button>
    </form>
  );
}
