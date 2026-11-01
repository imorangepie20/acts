"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatWon, parseSignedWon, parseWon } from "@/lib/money";
import { cn } from "@/lib/utils";

const ERR = "금액을 올바르게 입력하세요.";

type Props = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** Accept a leading minus (a refund typed as a negative amount). */
  signed?: boolean;
};

/** Won amount input: shows thousands separators while typing; null when empty or invalid. */
export function MoneyInput({ value, onValueChange, className, id, signed = false, ...props }: Props) {
  const parse = signed ? parseSignedWon : parseWon;
  const [text, setText] = useState(value === null ? "" : formatWon(value));
  const [shown, setShown] = useState(value);
  // Adopt values set from outside (e.g. 합계 filling 공급가액, or a form reset).
  if (value !== shown) {
    setShown(value);
    if (value !== parse(text)) setText(value === null ? "" : formatWon(value));
  }

  // A lone "-" is the start of a negative amount, not an error.
  const invalid = text.trim() !== "" && !(signed && text.trim() === "-") && parse(text) === null;
  const errorId = id ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <Input
        {...props}
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className={cn("text-right tabular-nums", className)}
        onChange={(e) => {
          const raw = e.target.value;
          const n = parse(raw);
          const next = n === null ? raw : formatWon(n);
          setText(next);
          setShown(n);
          onValueChange(n);
        }}
      />
      {invalid && (
        <p id={errorId} className="text-xs text-destructive">
          {ERR}
        </p>
      )}
    </div>
  );
}
