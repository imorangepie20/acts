import { DownloadDialog } from "@/components/payroll/withholding/download-dialog";
import { EMPTY_SEMIANNUAL_NOTICE } from "@/lib/withholding/notices";
import { KeyMissingAlert } from "@/components/payroll/key-missing";
import { SimplifiedPreview } from "@/components/payroll/withholding/simplified-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { UNVERIFIED_NOTICE } from "@/lib/withholding/notices";
import { requirePermission } from "@/server/auth/dal";
import { encryptionKeyMessage } from "@/server/auth/mfa";
import { getCompany } from "@/server/company/service";
import { MissingEncryptionKeyError } from "@/server/crypto/secret";
import { db } from "@/server/db";
import { loadSimplifiedRows, parseSimplifiedParams, type SimplifiedRow } from "@/server/withholding/simplified";

export default async function Page({ searchParams }: { searchParams: Promise<{ year?: string; half?: string }> }) {
  await requirePermission("payroll:manage");
  const { year, half } = parseSimplifiedParams(await searchParams);
  const company = await getCompany(db);
  let rows: SimplifiedRow[] | null = null;
  let keyError: string | undefined;
  try {
    rows = await loadSimplifiedRows(db, year, half);
  } catch (e) {
    if (!(e instanceof MissingEncryptionKeyError)) throw e;
    keyError = encryptionKeyMessage(e);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">근로소득 간이지급명세서</h1>
        {rows && rows.length > 0 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={`/api/exports/simplified-statement?year=${year}&half=${half}`} />}
            >
              Excel
            </Button>
            <DownloadDialog year={year} half={half} individual={company.businessType === "individual"} />
          </div>
        )}
      </div>
      <Alert>
        <AlertDescription>{UNVERIFIED_NOTICE}</AlertDescription>
      </Alert>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ss-year">연도</Label>
          <Input id="ss-year" name="year" type="number" min={2000} max={2100} required className="w-28" defaultValue={year} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ss-half">반기</Label>
          <NativeSelect id="ss-half" name="half" defaultValue={String(half)}>
            <option value="1">상반기 (1~6월 귀속)</option>
            <option value="2">하반기 (7~12월 귀속)</option>
          </NativeSelect>
        </div>
        <Button type="submit">조회</Button>
      </form>
      <p className="text-sm text-muted-foreground">
        확정된 급여 대장만 담깁니다. 세무서코드·홈택스 ID·담당자는 회사 정보에서 입력합니다. 주민등록번호 원문은 내려받은 파일에만 들어갑니다.
      </p>
      {keyError && <KeyMissingAlert message={keyError} />}
      {rows && rows.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">{EMPTY_SEMIANNUAL_NOTICE}</p>
      )}
      {rows && rows.length > 0 && <SimplifiedPreview rows={rows} />}
    </div>
  );
}
