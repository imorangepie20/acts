import { cn } from "@/lib/utils";
import { formatWon } from "@/lib/money";

/** Right-aligned won amount; negatives are prefixed "-" and shown in the destructive color. */
export function Money({ value, className }: { value: number; className?: string }) {
  const negative = value < 0;
  return (
    <span className={cn("block text-right tabular-nums", negative && "text-destructive", className)}>
      {negative ? "-" : ""}
      {formatWon(Math.abs(value))}
    </span>
  );
}
