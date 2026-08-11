# Auto Payroll Journal Voucher (JV) Management & Consolidation Rules

This document defines the specification and rules for automatically generating and updating monthly consolidated **Draft Journal Vouchers (JVs)** in `payroll.service.ts` whenever a location's payroll is confirmed or approved.

---

## 1. Consolidation & Draft JV Management Rules

1. **Single JV per Month**:
   - Each month (e.g., `JUL'26`) has **only one** single consolidated Draft Journal Voucher (JV).
2. **Upsert Logic**:
   - **First Location Confirmed**: Create a new Draft JV with the description:
     `Auto-generated Salary JV for {{MONTH}} {{YEAR}}` (e.g., `Auto-generated Salary JV for JUL 2026`).
   - **Subsequent Locations Confirmed**: Recalculate all confirmed locations for that month and **overwrite/update** details on the existing Draft JV so that all confirmed locations' aggregate data displays in a single JV.
3. **JV Status**: Draft status (`pending` or `pending_check`).
4. **JV Date**: Set to the payroll confirmation date or month-end date.

---

## 2. Tag / Sub-Account Lookup Rules

For every detail line item in the JV, `tagAccountId` is resolved using the following logic:
- **Parent Account ID**: Resolved via `FKAccountCode` (e.g., `70010001`, `80010001`, `12030002`, `12030003`, etc.).
- **Tag Account ID**: Looked up under the parent account by matching `TagID` (code) or `SubAccountName` (name) against child chart-of-account records. If not found directly under parent, fallback lookup is performed across global sub-accounts.

---

## 3. Debit Entries (Expenses & Payments)

| # | Entry Description | Parent Account | Tag / Sub-Account | Narration Format | Debit Amount |
|---|-------------------|----------------|-------------------|------------------|--------------|
| 1 | **Gross Salary & Allowances (Office / Management)** | `70010001` - SALARIES & ALLOWANCES | Location Code (e.g., `C00001`, `C10001`) | `REC SALARY FOR {{MONTH}}'{{YY}}, {{SUB_ACCOUNT_NAME}}` | Location-wise total gross salary (excluding incentive commission) |
| 2 | **Gross Salary & Allowances (Stores / Retail / Warehouses)** | `80010001` - SALARIES & ALLOWANCES | Location Code (e.g., `SS1001`, `N10001`) | `REC SALARY FOR {{MONTH}}'{{YY}}, {{SUB_ACCOUNT_SHORT_NAME}}` | Location-wise total gross salary (excluding incentive commission) |
| 3 | **Commission / Incentive Allowance (Stores / Retail)** | `12030002` - A/P-EMPLOYEES | Location Code (e.g., `SS1002`, `N10001`, `CK1001`) | `REC PMT OF COMMISSION FOR {{MONTH}}'{{YY}}, {{SUB_ACCOUNT_SHORT_NAME}}` | Location-wise total allowance amount with type `incentive` / `commission` |
| 4 | **EOBI Employer Contribution (Office / Management)** | `70010005` - EOBI CONTRIBUTION | Location Code (e.g., `C00001`, `C10001`) | `REC EOBI CONTR. FOR {{MONTH}}'{{YY}}, {{SUB_ACCOUNT_NAME}}` | Office-wise Employer EOBI Contribution sum |
| 5 | **EOBI Employer Contribution (Stores / Retail)** | `80010005` - EOBI CONTRIBUTION | Location Code (e.g., `SS1001`, `N10001`) | `REC EOBI CONTR. FOR {{MONTH}}'{{YY}}, {{SUB_ACCOUNT_SHORT_NAME}}` | Store-wise Employer EOBI Contribution sum |

---

## 6. Credit Entries (Liabilities & Deductions)

| # | Entry Description | Parent Account | Tag / Sub-Account | Narration Format | Credit Amount |
|---|-------------------|----------------|-------------------|------------------|---------------|
| 6 | **Net Salary Payable (Bank Transfer)** | `12030003` - A/P SALARY | `SP0001` - SALARY P/A - A/C TRF | `REC SALARY P/A TO EMPLOYEES A/C TRANSFER FOR {{MONTH}}'{{YY}}` | Total Net Salary sum for Bank Transfer employees (all confirmed locations) |
| 7 | **Net Salary Payable (Cash / Cheque)** | `12030003` - A/P SALARY | `SP0002` - SALARY P/A - CHQ/CSH | `REC SALARY P/A TO EMPLOYEES TRHU CHQ FOR {{MONTH}}'{{YY}}` | Total Net Salary sum for Cash/Cheque employees (all confirmed locations) |
| 8 | **Income Tax / Withholding Tax Payable** | `12060001` - WH TAX PAYABLE SALARY | `T00001` - SALARY | `REC DEDUCTION OF WHTAX FROM SALARY FOR {{MONTH}}'{{YY}}` | Total Income Tax deduction sum |
| 9 | **Provident Fund Payable (Employer Share)** | `12030004` - A/P PROVIDENT FUND | `C00001` - COMPANY | `REC P.F. CO'S CONT. FOR {{MONTH}}'{{YY}}` | Total Employer PF Contribution |
| 10 | **Provident Fund Payable (Employee Share)** | `12030004` - A/P PROVIDENT FUND | `C00001` - COMPANY | `REC P.F. EMPLOYEES CONT. FOR {{MONTH}}'{{YY}}` | Total Employee PF Deduction |
| 11 | **Advance Against Salary Recovery** | `31030001` - ADVANCE AGAINST SALARY | Employee Code/Name (e.g., `EMP056` - IMRAN KHALID) | `REC DEDUCTION AG. ADVANCE FROM SALARY FOR {{MONTH}}'{{YY}}` | Per employee advance salary deduction sum |
| 12 | **EOBI Payable** | `12030005` - A/P EOBI | `C00001` - COMPANY | `REC EOBI CONT. FOR {{MONTH}}'{{YY}} {{LOCATION}}` | Region-wise EOBI total (Employer + Employee share, e.g., `KHI`, `WH`, `LHR`, `FSD`, `ISB`) |
| 13 | **Loan to Employees Recovery** | `31030002` - LOAN TO EMPLOYEES | Employee Code/Name (e.g., `EMP006` - MUHAMMAD ANWARULLAH ANSARI) | `REC REPAYMENT OF LOAN FROM SALARY FOR {{MONTH}}'{{YY}}` | Per employee loan repayment installment sum |

---

## 5. Rounding & Balancing Rules

- **Balanced Voucher Guarantee**: Total Debits must equal Total Credits (`Total Dr == Total Cr`).
- **Rounding Adjustment**: If a rounding difference occurs due to decimal calculations (`diff = Total Dr - Total Cr`), it is automatically adjusted on the **first Credit line** item (or first Debit line item if credit exceeds debit).

---

## 6. Implementation Workflow in `payroll.service.ts`

When `confirmPayroll()` is executed for a location:
1. Payroll details are recorded and marked as `confirmed`.
2. `upsertMonthlySalaryJournalVoucher(month, year, generatedBy)` is invoked.
3. It fetches all confirmed payroll headers for `month` and `year`.
4. It aggregates location-level gross salaries, incentives, EOBI, PF, bank/cash net salaries, advance recoveries, and loan repayments.
5. Resolves chart of account IDs and tag IDs dynamically.
6. Constructs JV detail lines sorted by standard account code sequence.
7. Performs rounding balancing.
8. Checks if a JV with description `Auto-generated Salary JV for {{MONTH}} {{YEAR}}` exists:
   - If **found**: Deletes existing details and updates with recalculated lines & status `pending`.
   - If **not found**: Calls `journalVoucherService.create()` to create a new draft JV with status `pending`.
