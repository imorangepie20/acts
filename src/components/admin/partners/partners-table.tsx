"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBusinessNumber, normalizeBusinessNumber } from "@/lib/business-number";
import type { PartnerRow } from "@/server/partners/service";
import { CreatePartnerForm, EditPartnerForm } from "./partner-forms";

export function PartnersTable({ rows }: { rows: PartnerRow[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PartnerRow | null>(null);
  const [text, setText] = useState("");

  const data = useMemo(() => {
    const q = text.trim().toLowerCase();
    const digits = normalizeBusinessNumber(q);
    return rows.filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        (digits !== "" && (r.businessNumber ?? "").includes(digits)),
    );
  }, [rows, text]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          aria-label="거래처 검색"
          placeholder="거래처명 또는 사업자등록번호"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-64"
        />
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button />}>거래처 추가</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>거래처 추가</DialogTitle>
            </DialogHeader>
            <CreatePartnerForm onDone={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>거래처명</TableHead>
              <TableHead>사업자등록번호</TableHead>
              <TableHead>대표자</TableHead>
              <TableHead>연락처</TableHead>
              <TableHead>상태</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.businessNumber ? formatBusinessNumber(r.businessNumber) : "-"}</TableCell>
                <TableCell>{r.representative ?? "-"}</TableCell>
                <TableCell>{r.phone ?? "-"}</TableCell>
                <TableCell>
                  <Badge variant={r.isActive ? "secondary" : "destructive"}>
                    {r.isActive ? "사용" : "중지"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                      수정
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>거래처 수정</DialogTitle>
              </DialogHeader>
              <EditPartnerForm partner={editing} onDone={() => setEditing(null)} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
