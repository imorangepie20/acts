"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatBusinessNumber } from "@/lib/business-number";
import type { DepartmentRow, SiteRow } from "@/server/sites/service";
import {
  createDepartmentAction,
  createSiteAction,
  updateDepartmentAction,
  updateSiteAction,
  type SiteActionState,
} from "@/app/(dashboard)/admin/sites/actions";

type Action = (prev: SiteActionState, fd: FormData) => Promise<SiteActionState>;

function useMasterForm(action: Action, onDone: () => void, message: string) {
  const [state, formAction, pending] = useActionState<SiteActionState, FormData>(action, {});
  useEffect(() => {
    if (state.success) {
      toast.success(message);
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);
  return { state, formAction, pending };
}

type FieldsProps = {
  prefix: string;
  state: SiteActionState;
  formAction: (fd: FormData) => void;
  pending: boolean;
  submitLabel: string;
  nameLabel: string;
  /** Present only when editing. */
  id?: number;
  name?: string;
  isActive?: boolean;
  /** Sites only. */
  withBusinessNumber?: boolean;
  businessNumber?: string | null;
};

function Fields(p: FieldsProps) {
  const v = p.state.values;
  const editing = p.id !== undefined;
  const bn = p.businessNumber ? formatBusinessNumber(p.businessNumber) : "";
  return (
    <form action={p.formAction} className="flex flex-col gap-4">
      {editing && <input type="hidden" name="id" value={p.id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${p.prefix}-name`}>{p.nameLabel}</Label>
        <Input id={`${p.prefix}-name`} name="name" required defaultValue={v ? (v.name ?? "") : (p.name ?? "")} />
      </div>
      {p.withBusinessNumber && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${p.prefix}-bn`}>사업자등록번호</Label>
          <Input
            id={`${p.prefix}-bn`}
            name="businessNumber"
            inputMode="numeric"
            placeholder="000-00-00000"
            autoComplete="off"
            defaultValue={v ? (v.businessNumber ?? "") : bn}
          />
        </div>
      )}
      {editing && (
        <div className="flex items-center gap-3">
          <Switch
            id={`${p.prefix}-active`}
            name="isActive"
            value="true"
            uncheckedValue="false"
            defaultChecked={v ? v.isActive === "true" : p.isActive}
          />
          <Label htmlFor={`${p.prefix}-active`}>사용</Label>
        </div>
      )}
      {p.state.error && (
        <p role="alert" className="text-sm text-destructive">
          {p.state.error}
        </p>
      )}
      <Button type="submit" disabled={p.pending}>
        {p.submitLabel}
      </Button>
    </form>
  );
}

export function CreateSiteForm({ onDone }: { onDone: () => void }) {
  const f = useMasterForm(createSiteAction, onDone, "사업장을 추가했습니다.");
  return (
    <Fields key={f.state.nonce} prefix="new-site" nameLabel="사업장명" withBusinessNumber submitLabel="추가" {...f} />
  );
}

export function EditSiteForm({ site, onDone }: { site: SiteRow; onDone: () => void }) {
  const f = useMasterForm(updateSiteAction, onDone, "저장했습니다.");
  return (
    <Fields
      key={f.state.nonce}
      prefix="edit-site"
      nameLabel="사업장명"
      withBusinessNumber
      submitLabel="저장"
      id={site.id}
      name={site.name}
      businessNumber={site.businessNumber}
      isActive={site.isActive}
      {...f}
    />
  );
}

export function CreateDepartmentForm({ onDone }: { onDone: () => void }) {
  const f = useMasterForm(createDepartmentAction, onDone, "부서를 추가했습니다.");
  return <Fields key={f.state.nonce} prefix="new-dept" nameLabel="부서명" submitLabel="추가" {...f} />;
}

export function EditDepartmentForm({ department, onDone }: { department: DepartmentRow; onDone: () => void }) {
  const f = useMasterForm(updateDepartmentAction, onDone, "저장했습니다.");
  return (
    <Fields
      key={f.state.nonce}
      prefix="edit-dept"
      nameLabel="부서명"
      submitLabel="저장"
      id={department.id}
      name={department.name}
      isActive={department.isActive}
      {...f}
    />
  );
}
