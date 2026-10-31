/** Notice on the ledgers (pages and Excel) when payroll vouchers were left out for a user without `payroll:manage`. */
export function hiddenPayrollNotice(n: number): string {
  return `급여 전표 ${n}건은 권한이 있어야 볼 수 있습니다. 이 때문에 잔액이 합계잔액시산표와 다를 수 있습니다.`;
}

/** Notice on the 세무사 package's 분개장, which never lists payroll vouchers. */
export function packagePayrollNotice(n: number): string {
  return `급여 전표 ${n}건은 제외했습니다. 급여 합계는 합계잔액시산표에 포함되어 있습니다.`;
}
