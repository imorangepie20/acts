"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import {
  addEmployeeToRunAction,
  removeEmployeeFromRunAction,
  updateRunLinesAction,
} from "@/app/(dashboard)/payroll/runs/actions";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MoneyInput } from "@/components/vouchers/money-input";
import { DEDUCTION_KEYS, DEDUCTION_LABELS } from "@/lib/payroll/labels";
import type { DeductionKey, LineResult } from "@/lib/payroll/types";
import { formatWon } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { RunLineChange } from "@/server/payroll/runs";

export type GridLine = {
  employeeId: number;
  employeeNo: string;
  name: string;
  amounts: Record<string, number>;
  overrides: Partial<Record<DeductionKey, number>>;
  /** The deductions before overrides (계산값). */
  calculated: Record<DeductionKey, number>;
  result: LineResult;
};

type Props = {
  runId: string;
  version: number;
  editable: boolean;
  items: { code: string; name: string }[];
  lines: GridLine[];
  /** Employees who can be added (employed in the 귀속월, not in the run yet). */
  candidates: { id: number; employeeNo: string; name: string }[];
};

/**
 * One won cell: saves on blur when the value changed. An empty item cell means 0; an empty
 * deduction cell clears the override (back to the 계산값).
 */
function WonCell({
  label,
  value,
  emptyIs,
  clearable = false,
  resetNonce,
  onCommit,
}: {
  label: string;
  value: number;
  emptyIs: number | null;
  /** An override that an empty cell clears. */
  clearable?: boolean;
  /** Bumped after a failed save: every cell drops its typed value and shows the stored one. */
  resetNonce: number;
  onCommit: (v: number | null) => void;
}) {
  const [v, setV] = useState<number | null>(value);
  const [shown, setShown] = useState(value);
  const [nonce, setNonce] = useState(resetNonce);
  if (value !== shown || resetNonce !== nonce) {
    setShown(value);
    setNonce(resetNonce);
    setV(value);
  }
  return (
    <MoneyInput
      aria-label={label}
      value={v}
      onValueChange={setV}
      className="h-8 w-28 px-2"
      onBlur={(e) => {
        if (v === null && e.currentTarget.value.trim() !== "") return; // invalid text: MoneyInput shows the error
        if (v === null) {
          setV(value); // shown again until the reload brings the recomputed value
          if (emptyIs === null) {
            if (clearable) onCommit(null);
          } else if (value !== emptyIs) onCommit(emptyIs);
          return;
        }
        if (v !== value) onCommit(v);
      }}
    />
  );
}

const money = (n: number) => formatWon(n);

export function RunGrid({ runId, version, editable, items, lines, candidates }: Props) {
  const router = useRouter();
  const versionRef = useRef(version);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState("");
  const [resetNonce, setResetNonce] = useState(0);
  useEffect(() => {
    if (version > versionRef.current) versionRef.current = version;
  }, [version]);

  /**
   * Saves are chained so each one carries the version the previous one returned. A refusal
   * (ERR_CONFLICT included) or a thrown call shows its message, resets every cell to the stored
   * value and reloads; the chain itself never rejects, so later edits still save.
   */
  const save = (change: RunLineChange) => {
    queue.current = queue.current.then(async () => {
      let error: string | null = null;
      try {
        const r = await updateRunLinesAction(runId, versionRef.current, [change]);
        if (r.ok) versionRef.current = r.value.version;
        else error = r.error;
      } catch {
        error = "저장하지 못했습니다. 다시 시도하세요.";
      }
      if (error !== null) {
        toast.error(error);
        setResetNonce((n) => n + 1);
      }
      router.refresh();
    });
  };

  const rowOp = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      await queue.current;
      const r = await fn();
      if (!r.ok) toast.error(r.error);
      else toast.success(done);
      router.refresh();
    });

  const sum = (f: (l: GridLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  const colCount = 2 + items.length + 1 + DEDUCTION_KEYS.length + 2 + (editable ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="급여 대장" className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-background">사번</TableHead>
              <TableHead>이름</TableHead>
              {items.map((i) => (
                <TableHead key={i.code} className="text-right">
                  {i.name}
                </TableHead>
              ))}
              <TableHead className="text-right">지급 계</TableHead>
              {DEDUCTION_KEYS.map((k) => (
                <TableHead key={k} className="text-right">
                  {DEDUCTION_LABELS[k]}
                </TableHead>
              ))}
              <TableHead className="text-right">공제 계</TableHead>
              <TableHead className="text-right">실지급액</TableHead>
              {editable && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={colCount} className="py-8 text-center text-muted-foreground">
                  대장에 사원이 없습니다.
                </TableCell>
              </TableRow>
            )}
            {lines.map((l) => (
              <TableRow key={l.employeeId}>
                <TableCell className="sticky left-0 z-10 bg-background tabular-nums">{l.employeeNo}</TableCell>
                <TableCell className="whitespace-nowrap">{l.name}</TableCell>
                {items.map((i) => (
                  <TableCell key={i.code} className="text-right tabular-nums">
                    {editable ? (
                      <WonCell
                        label={`${l.employeeNo} ${i.name}`}
                        value={l.amounts[i.code] ?? 0}
                        emptyIs={0}
                        resetNonce={resetNonce}
                        onCommit={(v) => save({ employeeId: l.employeeId, amounts: { [i.code]: v ?? 0 } })}
                      />
                    ) : (
                      money(l.amounts[i.code] ?? 0)
                    )}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium tabular-nums">{money(l.result.gross)}</TableCell>
                {DEDUCTION_KEYS.map((k) => {
                  const overridden = l.overrides[k] !== undefined;
                  const label = `${l.employeeNo} ${DEDUCTION_LABELS[k]}`;
                  return (
                    <TableCell key={k} className="text-right tabular-nums">
                      <div className="flex items-center justify-end gap-1">
                        {overridden && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span
                                  role="img"
                                  tabIndex={0}
                                  aria-label={`${label} 직접 입력 (계산값 ${money(l.calculated[k])}원)`}
                                  className="inline-block size-2 shrink-0 rounded-full bg-amber-500"
                                />
                              }
                            />
                            <TooltipContent>계산값 {money(l.calculated[k])}원</TooltipContent>
                          </Tooltip>
                        )}
                        {editable ? (
                          <WonCell
                            label={label}
                            value={l.result.deductions[k]}
                            emptyIs={null}
                            resetNonce={resetNonce}
                            clearable={overridden}
                            onCommit={(v) => save({ employeeId: l.employeeId, overrides: { [k]: v } })}
                          />
                        ) : (
                          <span className={cn(overridden && "font-medium")}>{money(l.result.deductions[k])}</span>
                        )}
                        {editable && overridden && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`${label} 계산값으로 되돌리기`}
                            onClick={() => save({ employeeId: l.employeeId, overrides: { [k]: null } })}
                          >
                            <XIcon />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  );
                })}
                <TableCell className="text-right tabular-nums">{money(l.result.totalDeductions)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{money(l.result.netPay)}</TableCell>
                {editable && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${l.employeeNo} ${l.name} 대장에서 빼기`}
                      disabled={pending}
                      onClick={() =>
                        rowOp(
                          () => removeEmployeeFromRunAction(runId, versionRef.current, l.employeeId),
                          `${l.name}을(를) 대장에서 뺐습니다.`,
                        )
                      }
                    >
                      <XIcon />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          {lines.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="sticky left-0 z-10 bg-muted">합계</TableCell>
                <TableCell className="tabular-nums">{lines.length}명</TableCell>
                {items.map((i) => (
                  <TableCell key={i.code} className="text-right tabular-nums">
                    {money(sum((l) => l.amounts[i.code] ?? 0))}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">{money(sum((l) => l.result.gross))}</TableCell>
                {DEDUCTION_KEYS.map((k) => (
                  <TableCell key={k} className="text-right tabular-nums">
                    {money(sum((l) => l.result.deductions[k]))}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">{money(sum((l) => l.result.totalDeductions))}</TableCell>
                <TableCell className="text-right tabular-nums">{money(sum((l) => l.result.netPay))}</TableCell>
                {editable && <TableCell />}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      {editable && candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="추가할 사원" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <NativeSelectOption value="">추가할 사원 선택</NativeSelectOption>
            {candidates.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.employeeNo} {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            disabled={pending || adding === ""}
            onClick={() =>
              rowOp(async () => {
                const r = await addEmployeeToRunAction(runId, versionRef.current, Number(adding));
                if (r.ok) setAdding("");
                return r;
              }, "사원을 대장에 추가했습니다.")
            }
          >
            사원 추가
          </Button>
        </div>
      )}
    </div>
  );
}
