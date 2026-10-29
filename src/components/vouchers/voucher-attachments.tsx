"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { removeAttachmentAction, uploadAttachmentAction } from "@/app/(dashboard)/vouchers/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { AttachmentRow } from "@/server/attachments/service";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;
const ERR_UPLOAD = "업로드에 실패했습니다. 다시 시도하세요.";
const ERR_REMOVE = "삭제에 실패했습니다. 다시 시도하세요.";

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Evidence files on the voucher detail page: list, preview link, upload and delete. */
export function VoucherAttachments({
  voucherId,
  attachments,
  canModify,
}: {
  voucherId: string;
  attachments: AttachmentRow[];
  canModify: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const upload = (file: File) =>
    startTransition(async () => {
      // Checked here too so an oversized photo gets the message instead of a request-size error.
      if (file.size > MAX_BYTES) {
        toast.error("파일은 10MB 이하여야 합니다.");
      } else {
        const fd = new FormData();
        fd.set("file", file);
        try {
          const r = await uploadAttachmentAction(voucherId, fd);
          if (r.ok) {
            toast.success("첨부되었습니다.");
            router.refresh();
          } else {
            toast.error(r.error);
          }
        } catch {
          // Network failure, a rejected request body, or a server error.
          toast.error(ERR_UPLOAD);
        }
      }
      if (input.current) input.current.value = "";
    });

  const remove = (id: string) =>
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof removeAttachmentAction>>;
      try {
        r = await removeAttachmentAction(id);
      } catch {
        return void toast.error(ERR_REMOVE);
      }
      if (!r.ok) return void toast.error(r.error);
      toast.success("첨부파일이 삭제되었습니다.");
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="voucher-attachments">증빙</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">첨부된 증빙이 없습니다.</p>
        ) : (
          <ul aria-labelledby="voucher-attachments" className="flex flex-col divide-y rounded-md border">
            {attachments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                {a.mimeType === "application/pdf" ? (
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate" title={a.fileName}>
                  {a.fileName}
                </span>
                <span className="text-muted-foreground tabular-nums">{formatSize(a.size)}</span>
                <a
                  href={`/api/attachments/${a.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                  aria-label={`${a.fileName} 미리보기`}
                >
                  미리보기
                </a>
                {canModify && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => remove(a.id)}
                    aria-label={`${a.fileName} 삭제`}
                  >
                    삭제
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canModify && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="attachment-file">증빙 파일 첨부</Label>
            {/* No `capture` attribute: phones then offer both the camera and the file picker (PDFs). */}
            <input
              ref={input}
              id="attachment-file"
              type="file"
              accept={ACCEPT}
              disabled={pending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
            <p className="text-xs text-muted-foreground">JPG, PNG, WEBP, PDF · 10MB 이하</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
