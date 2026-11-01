"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UNVERIFIED_NOTICE } from "@/lib/withholding/notices";

/**
 * 파일 내려받기: a real form POST, so the browser saves the file and the 대표자 주민등록번호
 * (individual businesses only) never goes into a URL. Errors come back as a text page in the new tab.
 */
export function DownloadDialog({ year, half, individual }: { year: number; half: 1 | 2; individual: boolean }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>파일 내려받기</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>간이지급명세서 파일</DialogTitle>
          <DialogDescription>{UNVERIFIED_NOTICE}</DialogDescription>
        </DialogHeader>
        <form method="post" action="/api/payroll/simplified-statement" target="_blank" className="flex flex-col gap-4">
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="half" value={half} />
          {individual && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="owner-rrn">대표자 주민등록번호</Label>
              <Input id="owner-rrn" name="ownerRrn" type="password" autoComplete="off" required placeholder="000000-0000000" />
              <p className="text-xs text-muted-foreground">이 파일에만 쓰이며 저장되지 않습니다.</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            내려받기를 하면 사원별 주민등록번호가 파일에 들어가며, 사원마다 조회 기록이 남습니다.
          </p>
          <DialogFooter>
            <Button type="submit">내려받기</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
