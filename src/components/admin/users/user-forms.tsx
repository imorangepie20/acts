"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import type { UserRow } from "@/server/users/service";
import {
  createUserAction,
  resetPasswordAction,
  updateUserAction,
  type UserActionState,
} from "@/app/(dashboard)/admin/users/actions";

type Action = (prev: UserActionState, fd: FormData) => Promise<UserActionState>;

function useUserForm(action: Action, onDone: () => void, message: string) {
  const [state, formAction, pending] = useActionState<UserActionState, FormData>(action, {});
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

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function RoleSelect({ id, defaultValue }: { id: string; defaultValue: Role }) {
  return (
    <select id={id} name="role" defaultValue={defaultValue} className={selectClass}>
      {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

export function CreateUserForm({ onDone }: { onDone: () => void }) {
  const { state, formAction, pending } = useUserForm(createUserAction, onDone, "사용자를 추가했습니다.");
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-email">이메일</Label>
        <Input id="new-email" name="email" type="email" autoComplete="off" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-name">이름</Label>
        <Input id="new-name" name="name" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-role">역할</Label>
        <RoleSelect id="new-role" defaultValue="staff" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">초기 비밀번호</Label>
        <Input id="new-password" name="password" type="password" autoComplete="new-password" required />
      </div>
      <FormError error={state.error} />
      <Button type="submit" disabled={pending}>
        추가
      </Button>
    </form>
  );
}

export function EditUserForm({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const { state, formAction, pending } = useUserForm(updateUserAction, onDone, "저장했습니다.");
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={user.id} />
      <div className="flex flex-col gap-1.5">
        <Label>이메일</Label>
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-name">이름</Label>
        <Input id="edit-name" name="name" defaultValue={user.name} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-role">역할</Label>
        <RoleSelect id="edit-role" defaultValue={user.role} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-active">상태</Label>
        <select
          id="edit-active"
          name="isActive"
          defaultValue={String(user.isActive)}
          className={selectClass}
        >
          <option value="true">사용</option>
          <option value="false">중지</option>
        </select>
      </div>
      <FormError error={state.error} />
      <Button type="submit" disabled={pending}>
        저장
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const { state, formAction, pending } = useUserForm(
    resetPasswordAction,
    onDone,
    "비밀번호를 초기화했습니다.",
  );
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={user.id} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password">새 비밀번호</Label>
        <Input id="reset-password" name="password" type="password" autoComplete="new-password" required />
      </div>
      <FormError error={state.error} />
      <Button type="submit" disabled={pending}>
        비밀번호 초기화
      </Button>
    </form>
  );
}
