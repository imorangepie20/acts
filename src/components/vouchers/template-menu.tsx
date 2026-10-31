"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { deleteTemplateAction, saveTemplateAction } from "@/app/(dashboard)/vouchers/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TemplateBody } from "@/lib/vouchers/templates";
import { ENTRY_TYPE_LABELS, type EntryType } from "@/lib/vouchers/types";
import type { TemplateRow } from "@/server/templates/service";
import type { GeneralRow } from "./general-form";
import type { PartnerValue } from "./partner-picker";
import type { TradeInitial } from "./trade-form";
import type { TransferInitial } from "./transfer-form";

/** A template turned into the initial state of the form for its tab. */
export type Loaded = {
  tab: EntryType;
  description: string;
  trade?: TradeInitial;
  transfer?: TransferInitial;
  general?: GeneralRow[];
  closing?: boolean;
};

export function toLoaded(t: TemplateRow): Loaded {
  const b = t.body;
  const partnerOf = (id: number | null): PartnerValue => t.partners.find((p) => p.id === id) ?? null;
  if (b.type === "transfer") {
    return {
      tab: "transfer",
      description: b.description,
      transfer: {
        partner: partnerOf(b.partnerId),
        simple: {
          debitAccountId: b.debitAccountId,
          creditAccountId: b.creditAccountId,
          amount: b.amount,
          evidenceType: b.evidenceType,
        },
      },
    };
  }
  if (b.type === "general") {
    return {
      tab: "general",
      description: b.description,
      closing: b.closing,
      general: b.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.side === "debit" ? l.amount : null,
        credit: l.side === "credit" ? l.amount : null,
        partner: partnerOf(l.partnerId),
        description: l.description,
      })),
    };
  }
  return {
    tab: b.type,
    description: b.description,
    trade: {
      partner: partnerOf(b.partnerId),
      simple: {
        mainAccountId: b.mainAccountId,
        counterAccountId: b.counterAccountId,
        evidenceType: b.evidenceType,
        vatType: b.vatType,
        vatDeductible: b.vatDeductible,
        supplyAmount: b.supplyAmount,
        vatAmount: b.vatAmount,
      },
    },
  };
}

export function TemplateMenu({ templates, onLoad }: { templates: TemplateRow[]; onLoad: (l: Loaded) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = templates.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <BookmarkIcon />
        템플릿
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <Input
          aria-label="템플릿 검색"
          placeholder="템플릿 검색"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {shown.length === 0 ? (
          <p className="p-2 text-center text-muted-foreground">
            {templates.length === 0 ? "저장된 템플릿이 없습니다." : "검색 결과가 없습니다."}
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col overflow-y-auto" aria-label="템플릿 목록">
            {shown.map((t) => (
              <li key={t.id} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent/50">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{ENTRY_TYPE_LABELS[t.body.type]}</div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${t.name} 불러오기`}
                  onClick={() => {
                    onLoad(toLoaded(t));
                    setOpen(false);
                  }}
                >
                  불러오기
                </Button>
                <DeleteTemplate template={t} />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DeleteTemplate({ template }: { template: TemplateRow }) {
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const r = await deleteTemplateAction(template.id);
      setOpen(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success("템플릿을 삭제했습니다.");
    } catch {
      toast.error("삭제하지 못했습니다. 다시 시도하세요.");
    } finally {
      setPending(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`${template.name} 삭제`} />}
      >
        <Trash2Icon />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>템플릿 삭제</AlertDialogTitle>
          <AlertDialogDescription>{`'${template.name}' 템플릿을 삭제할까요?`}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={run}>
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SaveTemplateDialog({ body, onClose }: { body: TemplateBody | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const close = () => {
    setName("");
    setError(null);
    onClose();
  };
  const submit = async () => {
    if (!body) return;
    setPending(true);
    setError(null);
    try {
      const r = await saveTemplateAction(name, body);
      if (!r.ok) return setError(r.error);
      toast.success("템플릿으로 저장했습니다.");
      close();
      router.refresh();
    } catch {
      setError("저장하지 못했습니다. 다시 시도하세요.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={body !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>템플릿으로 저장</DialogTitle>
          <DialogDescription>같은 이름이 있으면 덮어씁니다.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            aria-label="템플릿 이름"
            autoComplete="off"
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              저장
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
