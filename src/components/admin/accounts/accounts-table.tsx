"use client";

import { useMemo, useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
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
import { ACCOUNT_GROUPS, ACCOUNT_GROUP_LABELS, type AccountGroup } from "@/lib/accounts";
import type { AccountRow } from "@/server/accounts/service";
import { CreateAccountForm, EditAccountForm, selectClass } from "./account-forms";

export function AccountsTable({ rows }: { rows: AccountRow[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [group, setGroup] = useState<AccountGroup | "all">("all");
  const [text, setText] = useState("");

  const data = useMemo(() => {
    const q = text.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (group === "all" || r.group === group) &&
        (!q || r.code.includes(q) || r.name.toLowerCase().includes(q)),
    );
  }, [rows, group, text]);

  const columns = useMemo<ColumnDef<AccountRow>[]>(
    () => [
      { accessorKey: "code", header: "코드" },
      { accessorKey: "name", header: "계정명" },
      { id: "group", header: "구분", cell: ({ row }) => ACCOUNT_GROUP_LABELS[row.original.group] },
      {
        id: "requiresPartner",
        header: "거래처 필수",
        cell: ({ row }) => (row.original.requiresPartner ? "필수" : "-"),
      },
      {
        id: "status",
        header: "상태",
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? "secondary" : "destructive"}>
            {row.original.isActive ? "사용" : "숨김"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setEditing(row.original)}>
              수정
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="구분 필터"
            value={group}
            onChange={(e) => setGroup(e.target.value as AccountGroup | "all")}
            className={`${selectClass} w-44`}
          >
            <option value="all">전체</option>
            {ACCOUNT_GROUPS.map((g) => (
              <option key={g} value={g}>
                {ACCOUNT_GROUP_LABELS[g]}
              </option>
            ))}
          </select>
          <Input
            aria-label="코드 또는 계정명 검색"
            placeholder="코드 또는 계정명"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-56"
          />
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button />}>계정 추가</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>계정 추가</DialogTitle>
            </DialogHeader>
            <CreateAccountForm onDone={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
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

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>계정 수정</DialogTitle>
              </DialogHeader>
              <EditAccountForm account={editing} onDone={() => setEditing(null)} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
