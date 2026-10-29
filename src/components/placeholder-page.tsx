import { Construction } from "lucide-react";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-24 text-center">
      <Construction className="size-8 text-muted-foreground" />
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">이후 단계에서 구현됩니다.</p>
    </div>
  );
}
