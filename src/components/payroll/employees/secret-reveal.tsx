"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { SecretField } from "@/server/payroll/employees";
import { revealEmployeeSecretAction } from "@/app/(dashboard)/payroll/employees/actions";

type Props = { employeeId: number; field: SecretField; label: string; masked: string | null };

/**
 * Shows the masked value; 보기 fetches the plain value (an audit row is written each time) and
 * shows it inline. The plain value lives only in this component's state, never in page props.
 */
export function SecretReveal({ employeeId, field, label, masked }: Props) {
  const [plain, setPlain] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (masked === null) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm">-</span>
      </div>
    );
  }

  const reveal = () =>
    startTransition(async () => {
      const r = await revealEmployeeSecretAction(employeeId, field);
      if (r.ok) setPlain(r.value);
      else toast.error(r.error);
    });

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm tabular-nums" data-testid={`${field}-value`}>
          {plain ?? masked}
        </span>
        {plain === null ? (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={reveal} aria-label={`${label} 보기`}>
            보기
          </Button>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={() => setPlain(null)} aria-label={`${label} 숨기기`}>
            숨기기
          </Button>
        )}
      </div>
    </div>
  );
}
