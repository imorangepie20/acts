"use client";

import { useMemo, useState, useTransition } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/permissions";
import type { UserRow } from "@/server/users/service";
import { unlockUserAction } from "@/app/(dashboard)/admin/users/actions";
import { CreateUserForm, EditUserForm, ResetPasswordForm } from "./user-forms";

type Status = "사용" | "중지" | "잠김";
function statusOf(u: UserRow): Status {
  if (!u.isActive) return "중지";
  if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) return "잠김";
  return "사용";
}

const dateFmt = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Seoul",
});

type Dialogs = { kind: "edit" | "reset"; user: UserRow } | null;

export function UsersTable({ rows }: { rows: UserRow[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [, startTransition] = useTransition();

  const unlock = (u: UserRow) =>
    startTransition(async () => {
      const r = await unlockUserAction(u.id);
      if (r.error) toast.error(r.error);
      else toast.success("잠금을 해제했습니다.");
    });

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      { accessorKey: "email", header: "이메일" },
      { accessorKey: "name", header: "이름" },
      { id: "role", header: "역할", cell: ({ row }) => ROLE_LABELS[row.original.role] },
      {
        id: "status",
        header: "상태",
        cell: ({ row }) => {
          const s = statusOf(row.original);
          return <Badge variant={s === "사용" ? "secondary" : "destructive"}>{s}</Badge>;
        },
      },
      {
        id: "createdAt",
        header: "생성일",
        cell: ({ row }) => dateFmt.format(row.original.createdAt),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "edit", user: row.original })}>
              수정
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "reset", user: row.original })}>
              비밀번호 초기화
            </Button>
            <Button size="sm" variant="ghost" onClick={() => unlock(row.original)}>
              잠금 해제
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button />}>사용자 추가</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>사용자 추가</DialogTitle>
            </DialogHeader>
            <CreateUserForm onDone={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((c) => (
                  <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog?.kind === "edit" && (
            <>
              <DialogHeader>
                <DialogTitle>사용자 수정</DialogTitle>
              </DialogHeader>
              <EditUserForm user={dialog.user} onDone={() => setDialog(null)} />
            </>
          )}
          {dialog?.kind === "reset" && (
            <>
              <DialogHeader>
                <DialogTitle>비밀번호 초기화</DialogTitle>
              </DialogHeader>
              <ResetPasswordForm user={dialog.user} onDone={() => setDialog(null)} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
