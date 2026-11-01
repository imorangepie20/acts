"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EMPLOYER_RATE_KINDS,
  EMPLOYER_RATE_LABELS,
  type EmployerRateKind,
  type EmployerRateRow,
} from "@/lib/payroll/employer-rates";
import { addEmployerRateAction, deleteEmployerRateAction } from "@/app/(dashboard)/payroll/settings/actions";
import { selectClass } from "@/components/vouchers/shared";

/** 사업주만 내는 고용안정·직업능력개발과 산재보험 요율: dated rows the company enters itself. */
export function EmployerRatesCard({ rates }: { rates: EmployerRateRow[] }) {
  const [kind, setKind] = useState<EmployerRateKind>(EMPLOYER_RATE_KINDS[0]);
  const [from, setFrom] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const add = () =>
    startTransition(async () => {
      const r = await addEmployerRateAction({ kind, effectiveFrom: from, value: value.trim() === "" ? NaN : Number(value) });
      if (r.ok) {
        setError(null);
        setValue("");
        toast.success("요율을 추가했습니다.");
      } else setError(r.error);
    });
  const remove = (id: number) =>
    startTransition(async () => {
      const r = await deleteEmployerRateAction(id);
      if (r.ok) toast.success("요율을 삭제했습니다.");
      else toast.error(r.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>사업주 부담 요율</CardTitle>
        <CardDescription>
          사업주만 내는 보험료율입니다. 회사마다 달라 직접 입력하며, 입력하지 않으면 0%로 계산합니다. 다른 요율처럼
          귀속월 1일에 적용 중인 요율을 쓰고, 고용보험 보수(과세 지급액)에 곱합니다. 요율을 바꾸면 작성 중인 대장은
          재계산하세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          <li>
            고용안정·직업능력개발: 150인 미만 0.25%, 150인 이상 우선지원대상기업 0.45%, 150인 이상 1,000인 미만 0.65%,
            1,000인 이상·국가·지자체 0.85%. 고용보험 가입자에게만 적용합니다.
          </li>
          <li>
            산재보험: 근로복지공단이 고지한 업종 요율(출퇴근재해 요율 포함). 임원(등기임원)을 뺀 근로자에게 적용합니다.
          </li>
        </ul>
        <div className="rounded-md border">
          <Table aria-label="사업주 부담 요율">
            <TableHeader>
              <TableRow>
                <TableHead>종류</TableHead>
                <TableHead>적용 시작일</TableHead>
                <TableHead className="text-right">요율</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    입력한 요율이 없습니다. 모두 0%로 계산합니다.
                  </TableCell>
                </TableRow>
              ) : (
                rates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{EMPLOYER_RATE_LABELS[r.kind]}</TableCell>
                    <TableCell className="tabular-nums">{r.effectiveFrom}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.value}%</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          aria-label={`${EMPLOYER_RATE_LABELS[r.kind]} ${r.effectiveFrom} 삭제`}
                          onClick={() => remove(r.id)}
                        >
                          삭제
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <form
          className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="er-kind">종류</Label>
            <select
              id="er-kind"
              className={selectClass}
              value={kind}
              onChange={(e) => setKind(e.target.value as EmployerRateKind)}
            >
              {EMPLOYER_RATE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EMPLOYER_RATE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="er-from">적용 시작일</Label>
            <Input id="er-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="er-value">요율(%)</Label>
            <Input
              id="er-value"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.25"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            요율 추가
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
