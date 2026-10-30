"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  closeFiscalYearAction,
  reopenFiscalYearAction,
  saveTaxFiguresAction,
} from "@/app/(dashboard)/closing/opening/actions";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatWon, parseSignedWon } from "@/lib/money";
import { formatDateTime } from "@/lib/vouchers/dates";
import type { TaxFigures } from "@/server/closing/year";

const FIELDS: { key: keyof TaxFigures; label: string }[] = [
  { key: "totalAssets", label: "자산총계" },
  { key: "totalLiabilities", label: "부채총계" },
  { key: "totalEquity", label: "자본총계" },
  { key: "netIncome", label: "당기순이익" },
];

const EXPLANATION =
  "재무상태표 잔액은 다음 연도로 자동으로 이어집니다. 별도의 이월 전표는 만들지 않습니다. 차이가 있으면 세무사 결산 수정 내역을 결산 전표로 입력한 뒤 다시 확인하세요.";

type Texts = Record<keyof TaxFigures, string>;

const toTexts = (tax: TaxFigures | null): Texts => ({
  totalAssets: tax ? formatWon(tax.totalAssets) : "",
  totalLiabilities: tax ? formatWon(tax.totalLiabilities) : "",
  totalEquity: tax ? formatWon(tax.totalEquity) : "",
  netIncome: tax ? formatWon(tax.netIncome) : "",
});

export function YearClose({
  fiscalStart,
  fiscalEnd,
  system,
  tax,
  closed,
  closedAt,
  allMonthsClosed,
  prevHref,
  nextHref,
  monthsHref,
}: {
  fiscalStart: string;
  fiscalEnd: string;
  system: TaxFigures;
  tax: TaxFigures | null;
  closed: boolean;
  closedAt: string | null;
  allMonthsClosed: boolean;
  prevHref: string;
  nextHref: string;
  monthsHref: string;
}) {
  const router = useRouter();
  const [texts, setTexts] = useState<Texts>(() => toTexts(tax));
  const [pending, startTransition] = useTransition();
  const parsed = FIELDS.map((f) => parseSignedWon(texts[f.key]));
  const allValid = FIELDS.every((f, i) => texts[f.key].trim() !== "" && parsed[i] !== null);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(done);
      router.refresh();
    });

  const save = () =>
    run(
      () =>
        saveTaxFiguresAction(fiscalStart, {
          totalAssets: parsed[0],
          totalLiabilities: parsed[1],
          totalEquity: parsed[2],
          netIncome: parsed[3],
        }),
      "저장되었습니다.",
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground tabular-nums">
            회계연도 {fiscalStart} ~ {fiscalEnd}
          </p>
          {closed && <Badge>마감{closedAt ? ` ${formatDateTime(new Date(closedAt))}` : ""}</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={prevHref} />}>
            이전 연도
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={nextHref} />}>
            다음 연도
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table aria-label={`연도 이월 ${fiscalStart.slice(0, 4)}`}>
          <TableHeader>
            <TableRow>
              <TableHead>항목</TableHead>
              <TableHead className="text-right">시스템</TableHead>
              <TableHead className="text-right">세무사 신고</TableHead>
              <TableHead className="text-right">차이</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {FIELDS.map((f, i) => {
              const diff = parsed[i] === null ? null : parsed[i] - system[f.key];
              return (
                <TableRow key={f.key}>
                  <TableCell className="font-medium">{f.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(system[f.key])}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label={`세무사 ${f.label}`}
                      inputMode="numeric"
                      autoComplete="off"
                      value={texts[f.key]}
                      aria-invalid={(texts[f.key].trim() !== "" && parsed[i] === null) || undefined}
                      className="ml-auto w-40 text-right tabular-nums"
                      onChange={(e) => {
                        const raw = e.target.value;
                        const n = parseSignedWon(raw);
                        setTexts((t) => ({ ...t, [f.key]: n === null || n === 0 ? raw : formatWon(n) }));
                      }}
                    />
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${diff !== null && diff !== 0 ? "font-medium text-destructive" : ""}`}
                  >
                    {diff === null ? "-" : formatWon(diff)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">{EXPLANATION}</p>

      {!closed && !allMonthsClosed && (
        <p className="text-sm text-muted-foreground">
          회계연도를 마감하려면 먼저{" "}
          <Link href={monthsHref} className="underline underline-offset-4">
            모든 월을 마감
          </Link>
          하세요.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending || !allValid} onClick={save}>
          세무사 금액 저장
        </Button>
        {closed ? (
          <YearAction
            label="마감 해제"
            title={`${fiscalStart.slice(0, 4)} 회계연도 마감을 해제할까요?`}
            body="해제하면 이 회계연도의 월 마감을 다시 해제할 수 있습니다."
            disabled={pending}
            onConfirm={() => run(() => reopenFiscalYearAction(fiscalStart), "마감을 해제했습니다.")}
          />
        ) : (
          <YearAction
            label="회계연도 마감"
            title={`${fiscalStart.slice(0, 4)} 회계연도를 마감할까요?`}
            body="마감하면 이 회계연도의 월 마감을 해제할 수 없습니다. 세무사 금액과 차이가 있어도 마감할 수 있습니다."
            disabled={pending || !allMonthsClosed}
            onConfirm={() => run(() => closeFiscalYearAction(fiscalStart), "마감되었습니다.")}
          />
        )}
      </div>
    </div>
  );
}

function YearAction({
  label,
  title,
  body,
  disabled,
  onConfirm,
}: {
  label: string;
  title: string;
  body: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger disabled={disabled} render={<Button />}>
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
