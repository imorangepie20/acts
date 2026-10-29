"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ACCOUNT_GROUPS,
  ACCOUNT_GROUP_LABELS,
  suggestGroup,
  type AccountGroup,
} from "@/lib/accounts";
import type { AccountRow } from "@/server/accounts/service";
import {
  createAccountAction,
  updateAccountAction,
  type AccountActionState,
} from "@/app/(dashboard)/admin/accounts/actions";

type Action = (prev: AccountActionState, fd: FormData) => Promise<AccountActionState>;

function useAccountForm(action: Action, onDone: () => void, message: string) {
  const [state, formAction, pending] = useActionState<AccountActionState, FormData>(action, {});
  useEffect(() => {
    if (state.success) {
      toast.success(message);
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);
  return { state, formAction, pending };
}

function FormError({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function GroupSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: AccountGroup;
  onChange: (g: AccountGroup) => void;
}) {
  return (
    <select
      id={id}
      name="group"
      value={value}
      onChange={(e) => onChange(e.target.value as AccountGroup)}
      className={selectClass}
    >
      {ACCOUNT_GROUPS.map((g) => (
        <option key={g} value={g}>
          {ACCOUNT_GROUP_LABELS[g]}
        </option>
      ))}
    </select>
  );
}

function SwitchField({
  id,
  name,
  label,
  defaultChecked,
}: {
  id: string;
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Switch id={id} name={name} value="true" uncheckedValue="false" defaultChecked={defaultChecked} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

type FieldProps = {
  state: AccountActionState;
  formAction: (fd: FormData) => void;
  pending: boolean;
};

export function CreateAccountForm({ onDone }: { onDone: () => void }) {
  const { state, formAction, pending } = useAccountForm(
    createAccountAction,
    onDone,
    "계정과목을 추가했습니다.",
  );
  return <CreateAccountFields key={state.nonce} state={state} formAction={formAction} pending={pending} />;
}

function CreateAccountFields({ state, formAction, pending }: FieldProps) {
  const v = state.values;
  const [group, setGroup] = useState<AccountGroup>((v?.group as AccountGroup | undefined) ?? "current_asset");
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-code">코드</Label>
        <Input
          id="new-code"
          name="code"
          inputMode="numeric"
          maxLength={3}
          autoComplete="off"
          defaultValue={v?.code ?? ""}
          onChange={(e) => {
            const g = suggestGroup(e.target.value);
            if (g) setGroup(g);
          }}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-name">계정명</Label>
        <Input id="new-name" name="name" defaultValue={v?.name ?? ""} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-group">구분</Label>
        <GroupSelect id="new-group" value={group} onChange={setGroup} />
      </div>
      <SwitchField
        id="new-partner"
        name="requiresPartner"
        label="거래처 필수"
        defaultChecked={v ? v.requiresPartner === "true" : false}
      />
      <FormError error={state.error} />
      <Button type="submit" disabled={pending}>
        추가
      </Button>
    </form>
  );
}

export function EditAccountForm({ account, onDone }: { account: AccountRow; onDone: () => void }) {
  const { state, formAction, pending } = useAccountForm(updateAccountAction, onDone, "저장했습니다.");
  return (
    <EditAccountFields
      key={state.nonce}
      account={account}
      state={state}
      formAction={formAction}
      pending={pending}
    />
  );
}

function EditAccountFields({ account, state, formAction, pending }: FieldProps & { account: AccountRow }) {
  const v = state.values;
  const [group, setGroup] = useState<AccountGroup>((v?.group as AccountGroup | undefined) ?? account.group);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={account.id} />
      <div className="flex flex-col gap-1.5">
        <Label>코드</Label>
        <p className="text-sm text-muted-foreground">{account.code}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-name">계정명</Label>
        <Input id="edit-name" name="name" defaultValue={v?.name ?? account.name} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-group">구분</Label>
        <GroupSelect id="edit-group" value={group} onChange={setGroup} />
      </div>
      <SwitchField
        id="edit-partner"
        name="requiresPartner"
        label="거래처 필수"
        defaultChecked={v ? v.requiresPartner === "true" : account.requiresPartner}
      />
      <SwitchField
        id="edit-active"
        name="isActive"
        label="사용"
        defaultChecked={v ? v.isActive === "true" : account.isActive}
      />
      <FormError error={state.error} />
      <Button type="submit" disabled={pending}>
        저장
      </Button>
    </form>
  );
}
