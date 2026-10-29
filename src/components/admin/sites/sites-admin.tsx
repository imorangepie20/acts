"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBusinessNumber } from "@/lib/business-number";
import type { DepartmentRow, SiteRow } from "@/server/sites/service";
import { CreateDepartmentForm, CreateSiteForm, EditDepartmentForm, EditSiteForm } from "./site-forms";

function StatusBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "secondary" : "destructive"}>{active ? "사용" : "중지"}</Badge>;
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-end">
      <Button size="sm" variant="ghost" onClick={onClick}>
        수정
      </Button>
    </div>
  );
}

function SitesCard({ rows }: { rows: SiteRow[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SiteRow | null>(null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>사업장</CardTitle>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button size="sm" />}>사업장 추가</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>사업장 추가</DialogTitle>
            </DialogHeader>
            <CreateSiteForm onDone={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>사업장명</TableHead>
                <TableHead>사업자등록번호</TableHead>
                <TableHead>상태</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.businessNumber ? formatBusinessNumber(r.businessNumber) : "-"}</TableCell>
                  <TableCell>
                    <StatusBadge active={r.isActive} />
                  </TableCell>
                  <TableCell>
                    <EditButton onClick={() => setEditing(r)} />
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
                  <DialogTitle>사업장 수정</DialogTitle>
                </DialogHeader>
                <EditSiteForm site={editing} onDone={() => setEditing(null)} />
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function DepartmentsCard({ rows }: { rows: DepartmentRow[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>부서</CardTitle>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button size="sm" />}>부서 추가</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>부서 추가</DialogTitle>
            </DialogHeader>
            <CreateDepartmentForm onDone={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">부서를 추가하면 전표 입력에 부서 항목이 나타납니다.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>부서명</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>
                      <StatusBadge active={r.isActive} />
                    </TableCell>
                    <TableCell>
                      <EditButton onClick={() => setEditing(r)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            {editing && (
              <>
                <DialogHeader>
                  <DialogTitle>부서 수정</DialogTitle>
                </DialogHeader>
                <EditDepartmentForm department={editing} onDone={() => setEditing(null)} />
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function SitesAdmin({ sites, departments }: { sites: SiteRow[]; departments: DepartmentRow[] }) {
  return (
    <div className="flex flex-col gap-6">
      <SitesCard rows={sites} />
      <DepartmentsCard rows={departments} />
    </div>
  );
}
