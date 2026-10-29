"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatBusinessNumber } from "@/lib/business-number";
import type { PartnerRow } from "@/server/partners/service";
import {
  createPartnerAction,
  updatePartnerAction,
  type PartnerActionState,
} from "@/app/(dashboard)/admin/partners/actions";

type Action = (prev: PartnerActionState, fd: FormData) => Promise<PartnerActionState>;

function usePartnerForm(action: Action, onDone: () => void, message: string) {
  const [state, formAction, pending] = useActionState<PartnerActionState, FormData>(action, {});
  useEffect(() => {
    if (state.success) {
      toast.success(message);
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);
  return { state, formAction, pending };
}

type TextField = "name" | "businessNumber" | "representative" | "phone" | "email" | "memo";

type FieldsProps = {
  prefix: string;
  state: PartnerActionState;
  formAction: (fd: FormData) => void;
  pending: boolean;
  partner?: PartnerRow;
  submitLabel: string;
};

function PartnerFields({ prefix, state, formAction, pending, partner, submitLabel }: FieldsProps) {
  const v = state.values;
  const initial = (k: TextField): string => {
    if (v) return v[k] ?? "";
    const raw = partner?.[k] ?? "";
    return k === "businessNumber" && raw ? formatBusinessNumber(raw) : raw;
  };
  const field = (k: TextField, label: string, extra: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${prefix}-${k}`}>{label}</Label>
      <Input id={`${prefix}-${k}`} name={k} defaultValue={initial(k)} {...extra} />
    </div>
  );
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {partner && <input type="hidden" name="id" value={partner.id} />}
      {field("name", "거래처명", { required: true })}
      {field("businessNumber", "사업자등록번호", {
        inputMode: "numeric",
        placeholder: "000-00-00000",
        autoComplete: "off",
      })}
      {field("representative", "대표자")}
      {field("phone", "연락처")}
      {field("email", "이메일", { type: "email" })}
      {field("memo", "메모")}
      {partner && (
        <div className="flex items-center gap-3">
          <Switch
            id={`${prefix}-active`}
            name="isActive"
            value="true"
            uncheckedValue="false"
            defaultChecked={v ? v.isActive === "true" : partner.isActive}
          />
          <Label htmlFor={`${prefix}-active`}>사용</Label>
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function CreatePartnerForm({ onDone }: { onDone: () => void }) {
  const { state, formAction, pending } = usePartnerForm(createPartnerAction, onDone, "거래처를 추가했습니다.");
  return (
    <PartnerFields
      key={state.nonce}
      prefix="new"
      state={state}
      formAction={formAction}
      pending={pending}
      submitLabel="추가"
    />
  );
}

export function EditPartnerForm({ partner, onDone }: { partner: PartnerRow; onDone: () => void }) {
  const { state, formAction, pending } = usePartnerForm(updatePartnerAction, onDone, "저장했습니다.");
  return (
    <PartnerFields
      key={state.nonce}
      prefix="edit"
      state={state}
      formAction={formAction}
      pending={pending}
      partner={partner}
      submitLabel="저장"
    />
  );
}
