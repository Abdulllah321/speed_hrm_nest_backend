# Finance Account Configuration — Complete Reference

> **Purpose of this document**
> This is the single source of truth for every `AccountRoleKey` in the system.
> Use it to:
> 1. Walk the client through their account configuration screen
> 2. Verify each mapping is correct before go-live
> 3. Understand exactly which transaction hits which account
> 4. Identify gaps, conflicts, and open decisions that need client sign-off

---

## How the System Uses These Configs

Every service that posts a journal entry calls:

```typescript
// Single account
const accountId = await financeConfig.resolveAccount(AccountRoleKey.PURCHASES_LOCAL);

// Multiple accounts at once
const accounts = await financeConfig.resolveAccounts([
  AccountRoleKey.ACCOUNTS_RECEIVABLE,
  AccountRoleKey.SALES_REVENUE_WHOLESALE,
]);
```

If a key is **not configured**, the transaction throws a `400 Bad Request` and nothing posts. This is intentional — a misconfigured account is worse than a blocked transaction.

---

## Configuration Screen Checklist

Go to **Finance → Account Configuration** and verify each row below.
The "Expected Account" column shows what the client's COA should map to.

---

## Section 1 — PURCHASES

These keys are hit when a **Purchase Invoice is approved or cancelled**.

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 1 | `PURCHASES_LOCAL` | **Dr** on approval, Cr on cancellation | `60020002` | PURCHASES LOCAL | ☐ Confirm |
| 2 | `PURCHASES_IMPORT` | **Dr** on approval, Cr on cancellation | `60020001` | PURCHASES IMPORT | ☐ Confirm |
| 3 | `PURCHASES_CONSIGNMENT` | **Dr** on approval, Cr on cancellation | `60020003` | PURCHASES CONSIGNMENT | ☐ Confirm |
| 4 | `PURCHASES_RETURN` | **Cr** on purchase return / debit note | *(no code in COA — needs creation)* | PURCHASES RETURN | ⚠️ Gap |

### Journal: Purchase Invoice Approval
```
Dr  PURCHASES_LOCAL / PURCHASES_IMPORT / PURCHASES_CONSIGNMENT   [invoice total]
    Cr  Supplier's linked payable account(s)                      [invoice total]
```

### Journal: Purchase Invoice Cancellation (reversal)
```
Dr  Supplier's linked payable account(s)                          [invoice total]
    Cr  PURCHASES_LOCAL / PURCHASES_IMPORT / PURCHASES_CONSIGNMENT [invoice total]
```

> **⚠️ Current code issue:** The `approve()` method always uses `PURCHASES_LOCAL` regardless of invoice type.
> `PURCHASES_IMPORT` and `PURCHASES_CONSIGNMENT` are declared but never called.
> **Action needed:** Confirm with client whether they want invoice-type-based routing or a single purchases account.

---

## Section 2 — SUPPLIER / ACCOUNTS PAYABLE

These keys are used for **advance payments to suppliers** and as a **fallback payable account**.

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 5 | `ADVANCE_TO_SUPPLIERS` | **Dr** when advance paid; **Cr** when advance applied | `31030004` | ADVANCE TO SUPPLIERS | ☐ Confirm |
| 6 | `AP_PARTIES` | **Cr** on purchase invoice (fallback only) | `12030001` | A/P PARTIES | ☐ Confirm |

### Journal: Payment Voucher — Advance to Supplier
```
Dr  ADVANCE_TO_SUPPLIERS                [advance amount]
    Cr  Bank / Cash account             [advance amount]   ← passed directly in PV
```

### Journal: Advance Application (settling advance against invoice)
```
Dr  Supplier's linked payable account   [applied amount]
    Cr  ADVANCE_TO_SUPPLIERS            [applied amount]
```

> **Note:** `AP_PARTIES` is a fallback. The system first looks for accounts linked directly on the Supplier master record. `AP_PARTIES` is only used if the supplier has no linked accounts configured.

---

## Section 3 — SALES / ACCOUNTS RECEIVABLE

These keys are hit on **ERP wholesale sales invoices** and **POS retail sales**.

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 7 | `SALES_REVENUE_RETAIL` | **Cr** on POS sale; **Dr** on voucher issuance | `40020001` | RETAIL SALES | ☐ Confirm |
| 8 | `SALES_REVENUE_WHOLESALE` | **Cr** on ERP sale | `40010001` | WHOLE SALES | ☐ Confirm |
| 9 | `ACCOUNTS_RECEIVABLE` | **Dr** on ERP sale | `31020001` | A/R-SPORTS BRANDS | ⚠️ Discuss |
| 10 | `ADVANCE_FROM_CUSTOMERS` | **Cr** when customer advance received | `12020001` | ADVANCE FROM CUSTOMERS | ☐ Confirm |
| 11 | `SALES_RETURN_RETAIL` | **Dr** on POS retail return | `40020007` | RETAIL SALES RETURN | ☐ Confirm |
| 12 | `SALES_RETURN_WHOLESALE` | **Dr** on wholesale return | `40010007` | WHOLE SALES RETURN | ☐ Confirm |

### Journal: ERP Wholesale Sales Invoice
```
Dr  ACCOUNTS_RECEIVABLE                 [grand total]
    Cr  SALES_REVENUE_WHOLESALE         [subtotal excl. tax]
    Cr  SALES_TAX_PAYABLE_FEDERAL       [tax amount]        ← if applicable
```

### Journal: POS Retail Sale — Cash
```
Dr  CASH_IN_HAND                        [grand total]
    Cr  SALES_REVENUE_RETAIL            [subtotal excl. tax]
    Cr  SALES_TAX_PAYABLE_FEDERAL       [tax amount]        ← if applicable
```

### Journal: POS Retail Sale — Card
```
Dr  BANK_MERCHANT                       [gross card amount]
    Cr  SALES_REVENUE_RETAIL            [subtotal excl. tax]
    Cr  SALES_TAX_PAYABLE_FEDERAL       [tax amount]

Dr  BANK_COMMISSION_SELLING             [merchant commission]
    Cr  BANK_MERCHANT                   [commission deducted]
```

> **⚠️ Discussion point on `ACCOUNTS_RECEIVABLE`:**
> The client's COA has multiple A/R accounts by brand (`31020001` A/R-Sports Brands, `31020002` A/R-Institutes, `31020003` A/R-Watches). The system maps a single `ACCOUNTS_RECEIVABLE` key to one account. Ask the client: **do all wholesale debtors post to one A/R account, or should it route by customer type?** If by customer type, this needs a different design (customer-linked receivable accounts, similar to how supplier payables work).

---

## Section 4 — TAX

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 13 | `SALES_TAX_PAYABLE_FEDERAL` | **Cr** on sales (output tax) | `12040001` | SALES TAX PAYABLE-FEDERAL | ☐ Confirm |
| 14 | `SALES_TAX_PAYABLE_PROVINCIAL` | **Cr** on provincial sales tax | `12040002` | SALES TAX PAYABLE-PROVINCIAL | ☐ Confirm |
| 15 | `INPUT_TAX_RECOVERABLE` | **Dr** on goods purchases (input tax) | `31070003` | SALES TAX ON GOODS | ☐ Confirm |
| 16 | `WHT_SALARY` | **Cr** income tax withheld on salaries | `12060001` | WH TAX PAYABLE-SALARY | ☐ Confirm |
| 17 | `WHT_GOODS` | **Cr** WHT on goods purchases | `12060003` | WH TAX PAYABLE-GOODS | ☐ Confirm |
| 18 | `WHT_SERVICES` | **Cr** WHT on services | `12060004` | WH TAX PAYABLE-SERVICES | ☐ Confirm |

> **⚠️ `INPUT_TAX_RECOVERABLE` is declared but never called by any service.**
> Purchase invoices do not currently post an input tax debit line.
> **Action needed:** Confirm with client whether input tax should be posted at invoice approval, or handled manually via journal voucher.

> **⚠️ `SALES_TAX_PAYABLE_PROVINCIAL` is declared but never called.**
> All tax posting goes to `SALES_TAX_PAYABLE_FEDERAL` only.
> **Action needed:** Does the client have provincial tax transactions? If yes, which transactions trigger it?

---

## Section 5 — PAYROLL (Admin Department — code 70)

These keys are hit when **payroll is posted for admin / head-office staff**.

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 19 | `SALARIES_EXPENSE_ADMIN` | **Dr** gross salary | `70010001` | SALARIES & ALLOWANCES (Admin) | ☐ Confirm |
| 20 | `EOBI_EXPENSE_ADMIN` | **Dr** employer EOBI share | `70010005` | EOBI CONTRIBUTION (Admin) | ☐ Confirm |
| 21 | `PF_EXPENSE_ADMIN` | **Dr** employer PF share | `70010009` | P.F. CONTRIBUTION (Admin) | ☐ Confirm |

### Journal: Payroll Posting — Admin Department
```
Dr  SALARIES_EXPENSE_ADMIN              [gross salary]
Dr  EOBI_EXPENSE_ADMIN                  [employer EOBI share]
Dr  PF_EXPENSE_ADMIN                    [employer PF share]
    Cr  AP_SALARIES                     [net payable to employees]
    Cr  AP_EOBI                         [total EOBI payable]
    Cr  AP_PROVIDENT_FUND               [total PF payable]
    Cr  AP_SESSI                        [SESSI/PESSI/IESSI payable]
    Cr  WHT_SALARY                      [income tax withheld]
```

> **⚠️ Payroll journal posting is NOT yet implemented in `payroll.service.ts`.**
> The service calculates all figures correctly but does not call `financeConfig.resolveAccount()` or `accounting.postLines()`.
> **Action needed:** Payroll journal posting must be built before go-live. All 11 keys in Sections 5, 6, and 7 will be needed.

---

## Section 6 — PAYROLL (Selling & Distribution Department — code 80)

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 22 | `SALARIES_EXPENSE_SELLING` | **Dr** gross salary | `80010001` | SALARIES & ALLOWANCES (Selling) | ☐ Confirm |
| 23 | `EOBI_EXPENSE_SELLING` | **Dr** employer EOBI share | `80010005` | EOBI CONTRIBUTION (Selling) | ☐ Confirm |
| 24 | `PF_EXPENSE_SELLING` | **Dr** employer PF share | `80010009` | P.F. CONTRIBUTION (Selling) | ☐ Confirm |

### Journal: Payroll Posting — Selling Department
```
Dr  SALARIES_EXPENSE_SELLING            [gross salary]
Dr  EOBI_EXPENSE_SELLING                [employer EOBI share]
Dr  PF_EXPENSE_SELLING                  [employer PF share]
    Cr  AP_SALARIES                     [net payable to employees]
    Cr  AP_EOBI                         [total EOBI payable]
    Cr  AP_PROVIDENT_FUND               [total PF payable]
    Cr  AP_SESSI                        [SESSI/PESSI/IESSI payable]
    Cr  WHT_SALARY                      [income tax withheld]
```

> **Note:** The Cr side is identical for both departments — same 5 payable accounts.

---

## Section 7 — PAYROLL (Shared Payable Accounts — Cr side)

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 25 | `AP_SALARIES` | **Cr** net salary payable | `12030003` | A/P SALARIES | ☐ Confirm |
| 26 | `AP_EOBI` | **Cr** EOBI payable | `12030005` | A/P EOBI | ☐ Confirm |
| 27 | `AP_PROVIDENT_FUND` | **Cr** PF payable | `12030004` | A/P PROVIDENT FUND | ☐ Confirm |
| 28 | `AP_SESSI` | **Cr** SESSI/PESSI/IESSI payable | `12030006` | A/P SESSI/PESSI/IESSI | ☐ Confirm |
| 29 | `AP_SALARIES_FINAL_SETTLEMENT` | **Cr** gratuity / end-of-service payable | `12030007` | A/P SALARIES-FINAL SETTLEMENT | ☐ Confirm |

> **⚠️ `AP_SALARIES_FINAL_SETTLEMENT` is declared but no service calls it yet.**
> Final settlement posting needs to be built as part of the exit clearance / payroll module.

---

## Section 8 — INVENTORY / STOCK

These keys are hit on **GRN inbound**, **sales delivery (COGS)**, and **stock adjustments**.

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 30 | `STOCK_IN_TRADE_WAREHOUSE` | **Dr** on GRN inbound; **Cr** on COGS | `31010002` | STOCK AT END-WAREHOUSE | ☐ Confirm |
| 31 | `STOCK_IN_TRADE_STORES` | **Dr** on store transfer; **Cr** on COGS | `31010001` | STOCK AT END-STORES | ☐ Confirm |
| 32 | `COST_OF_GOODS_SOLD` | **Dr** on sales delivery | *(no code in COA — needs creation)* | COST OF GOODS SOLD | ⚠️ Gap |
| 33 | `STOCK_ADJUSTMENTS` | **Dr/Cr** on write-offs | `60040001` | STOCK ADJUSTMENTS | ☐ Confirm |
| 34 | `INVENTORY_SHORTAGE` | **Dr** on shortage | `60040002` | INVENTORY SHORT/EXCESS | ☐ Confirm |

### Journal: GRN Inbound (Stock Received)
```
Dr  STOCK_IN_TRADE_WAREHOUSE / STOCK_IN_TRADE_STORES    [cost value]
    Cr  PURCHASES_LOCAL / PURCHASES_IMPORT              [cost value]
```

### Journal: Cost of Goods Sold (on Sales Delivery)
```
Dr  COST_OF_GOODS_SOLD                  [cost of items delivered]
    Cr  STOCK_IN_TRADE_WAREHOUSE / STOCK_IN_TRADE_STORES [cost of items delivered]
```

### Journal: Stock Adjustment / Write-Off
```
Dr  STOCK_ADJUSTMENTS / INVENTORY_SHORTAGE   [adjustment value]
    Cr  STOCK_IN_TRADE_WAREHOUSE / STOCK_IN_TRADE_STORES [adjustment value]
```

> **⚠️ `COST_OF_GOODS_SOLD` has no matching account in the client's COA.**
> The COA has `60030001/60030002` (Closing Stocks) and `60010001/60010002` (Opening Stocks) but no standalone COGS account.
> **Action needed:** Client needs to either create a COGS account or confirm which existing account to use.

---

## Section 9 — POS PAYMENT METHODS

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 35 | `CASH_IN_HAND` | **Dr** on cash sale | `31090001` | CASH IN HAND | ☐ Confirm |
| 36 | `BANK_MERCHANT` | **Dr** on card sale (gross); **Cr** for commission deduction | *(client to specify which bank)* | Bank Current Account (Merchant) | ⚠️ Discuss |

> **⚠️ `BANK_MERCHANT` discussion point:**
> The client has 8 bank current accounts (`31100001`–`31100008`). Card settlements may go to different banks depending on the terminal. Ask: **is there one merchant settlement account, or does it vary by bank/terminal?**
> If it varies, `BANK_MERCHANT` as a single key is insufficient — you'd need per-terminal or per-bank configuration.

---

## Section 10 — POS VOUCHERS & LOYALTY

All voucher accounts are **liabilities** — they represent obligations to the customer.

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 37 | `CREDIT_VOUCHERS` | **Cr** on issuance; **Dr** on redemption | `12070006` | CREDIT VOUCHERS | ☐ Confirm |
| 38 | `GIFT_VOUCHERS` | **Cr** on issuance; **Dr** on redemption | `12070007` | GIFT VOUCHERS | ☐ Confirm |
| 39 | `GIFT_VOUCHERS_CORPORATE` | **Cr** on issuance; **Dr** on redemption | `12070008` | GIFT VOUCHERS CORPORATE | ☐ Confirm |
| 40 | `CLAIM_VOUCHERS` | **Cr** on issuance; **Dr** on redemption | `12070009` | CLAIM VOUCHERS | ☐ Confirm |
| 41 | `EXCHANGE_VOUCHERS` | **Cr** on issuance; **Dr** on redemption | `12070010` | EXCHANGE VOUCHERS | ☐ Confirm |
| 42 | `ALLIANCE_REWARD` | **Cr** on reward accrual | `12070011` | ALLIANCE & REWARD PROGRAM | ☐ Confirm |

### Journal: Voucher Issuance
```
Dr  SALES_REVENUE_RETAIL                [voucher face value]
    Cr  CREDIT_VOUCHERS / GIFT_VOUCHERS / ...  [voucher face value]
```

### Journal: Voucher Redemption
```
Dr  CREDIT_VOUCHERS / GIFT_VOUCHERS / ...  [redeemed amount]
    Cr  SALES_REVENUE_RETAIL               [redeemed amount]
```

### Journal: Alliance / Reward Accrual
```
Dr  SALES_REVENUE_RETAIL                [reward value accrued]
    Cr  ALLIANCE_REWARD                 [reward value accrued]
```

---

## Section 11 — POS FEES & CHARGES

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 43 | `POS_INTEGRATION_FEE_PAYABLE` | **Cr** FBR/integrator fee payable | `12060009` | POS INTEGRATION FEE - PAYABLE | ☐ Confirm |
| 44 | `POS_INTEGRATION_FEE_EXPENSE` | **Dr** FBR/integrator fee expense | `80210001` | BANK COMMISSIONS-MERCHANT (Selling) | ⚠️ Discuss |
| 45 | `BANK_COMMISSION_SELLING` | **Dr** merchant commission expense | `80210001` | BANK COMMISSIONS-MERCHANT (Selling) | ⚠️ Discuss |
| 46 | `BANK_COMMISSION_ADMIN` | **Dr** merchant commission expense (admin) | `70210001` | BANK COMMISSIONS-MERCHANT (Admin) | ☐ Confirm |

### Journal: POS Integration Fee (FBR / Integrator)
```
Dr  POS_INTEGRATION_FEE_EXPENSE         [fee amount]
    Cr  POS_INTEGRATION_FEE_PAYABLE     [fee amount]
```

> **⚠️ `POS_INTEGRATION_FEE_EXPENSE` and `BANK_COMMISSION_SELLING` both reference code `80210001`.**
> These are two different expense types sharing the same account. Ask the client:
> - Should POS integration fees and bank merchant commissions be tracked separately?
> - If yes, a new account code is needed for one of them.
> - If no, both keys can map to `80210001` — which is fine, just means no separate reporting.

---

## Section 12 — POS CASH MANAGEMENT

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 47 | `CASH_SHORTAGE_OVERAGE` | **Dr** on shortage; **Cr** on overage | `80220013` | CASH SHORTAGE & OVERAGES | ☐ Confirm |

### Journal: Cash Shortage (end-of-day)
```
Dr  CASH_SHORTAGE_OVERAGE               [shortage amount]
    Cr  CASH_IN_HAND                    [shortage amount]
```

### Journal: Cash Overage (end-of-day)
```
Dr  CASH_IN_HAND                        [overage amount]
    Cr  CASH_SHORTAGE_OVERAGE           [overage amount]
```

---

## Section 13 — FINANCIAL CHARGES

| # | Key | Dr / Cr | Expected Account Code | Expected Account Name | Status |
|---|-----|---------|----------------------|----------------------|--------|
| 48 | `BANK_CHARGES` | **Dr** general bank charges | `90010001` | BANK CHARGES *(needs creation in COA)* | ⚠️ Gap |
| 49 | `MARKUP_ON_LOAN` | **Dr** interest / mark-up on loans | `90010002` | MARKUP ON LOAN *(needs creation)* | ⚠️ Gap |
| 50 | `BANK_CHARGES_IMPORT` | **Dr** import LC / bank charges | `90030001` | BANK CHARGES IMPORT *(needs creation)* | ⚠️ Gap |
| 51 | `EXCHANGE_LOSS_IMPORT` | **Dr** exchange loss on imports | `90030003` | EXCHANGE LOSS IMPORT *(needs creation)* | ⚠️ Gap |

### Journal: Bank Charges
```
Dr  BANK_CHARGES                        [charge amount]
    Cr  Bank account                    [charge amount]   ← passed directly in JV
```

### Journal: Import Bank Charges / Exchange Loss
```
Dr  BANK_CHARGES_IMPORT / EXCHANGE_LOSS_IMPORT   [amount]
    Cr  Bank account                             [amount]
```

> **⚠️ Codes 90xxxxx do not exist in the client's current COA.**
> The COA provided goes up to code `8` (Selling & Distribution Expenses). Financial charges under code `9` are missing entirely.
> **Action needed:** Client must create a "Financial Charges" section in their COA, or confirm which existing expense accounts to use.

---

## Summary of Issues Requiring Client Decision

| # | Issue | Impact | Options |
|---|-------|--------|---------|
| A | `PURCHASES_IMPORT` / `PURCHASES_CONSIGNMENT` never called — all invoices use `PURCHASES_LOCAL` | Wrong expense account on import/consignment invoices | (1) Route by invoice type in code, or (2) use one purchases account for all |
| B | `ACCOUNTS_RECEIVABLE` is a single key but client has brand-specific A/R accounts | All wholesale debtors post to one account | (1) Accept single A/R account, or (2) link receivable account to customer master (like supplier payables) |
| C | `INPUT_TAX_RECOVERABLE` never called — no input tax journal on purchases | Input tax not recorded automatically | (1) Build input tax posting into purchase invoice approval, or (2) manual JV only |
| D | `COST_OF_GOODS_SOLD` has no matching account in COA | COGS journal will fail at runtime | Client must create a COGS account |
| E | `BANK_MERCHANT` is a single key — client has 8 bank accounts | Card settlements always post to one bank | (1) Accept single merchant account, or (2) per-terminal bank configuration |
| F | `POS_INTEGRATION_FEE_EXPENSE` and `BANK_COMMISSION_SELLING` share code `80210001` | No separate reporting of fee types | (1) Accept shared account, or (2) create separate account for one |
| G | Financial charges (codes 90xxxxx) missing from COA entirely | `BANK_CHARGES`, `MARKUP_ON_LOAN`, `BANK_CHARGES_IMPORT`, `EXCHANGE_LOSS_IMPORT` will fail | Client must add Financial Charges section to COA |
| H | Payroll journal posting not implemented | Payroll runs but no accounting entries created | Must be built before go-live |
| I | Discount accounts exist in COA but no `AccountRoleKey` for them | Discounts absorbed into net revenue, no gross/discount split in P&L | See `discount-accounting-design.md` for full spec |
| J | `PURCHASES_RETURN` has no matching account in COA | Purchase return journal will fail | Client must create a purchases return account |
| K | `SALES_TAX_PAYABLE_PROVINCIAL` declared but never called | Provincial tax not posted | Confirm if provincial tax transactions exist |
| L | `AP_SALARIES_FINAL_SETTLEMENT` declared but never called | Final settlement not journalized | Build as part of exit clearance module |

---

## Keys That Are Fully Implemented and Working

These keys are actively called by services today:

| Key | Called By |
|-----|-----------|
| `PURCHASES_LOCAL` | `purchase-invoice.service.ts` → `approve()` and `cancel()` |
| `ADVANCE_TO_SUPPLIERS` | `payment-voucher.service.ts` → advance application |
| `ACCOUNTS_RECEIVABLE` | `sales-invoice.service.ts` → `approve()` |
| `SALES_REVENUE_WHOLESALE` | `sales-invoice.service.ts` → `approve()` |

> Only 4 out of 51 keys are actively used today. The rest are either partially wired, declared for future use, or blocked by the issues listed above.

---

## Recommended Configuration Order for Go-Live

Configure in this order — each group must be done before the next module can be tested:

**Phase 1 — Core Purchasing**
`PURCHASES_LOCAL` → `PURCHASES_IMPORT` → `PURCHASES_CONSIGNMENT` → `AP_PARTIES` → `ADVANCE_TO_SUPPLIERS`

**Phase 2 — Core Sales**
`SALES_REVENUE_RETAIL` → `SALES_REVENUE_WHOLESALE` → `ACCOUNTS_RECEIVABLE` → `CASH_IN_HAND` → `BANK_MERCHANT` → `SALES_TAX_PAYABLE_FEDERAL`

**Phase 3 — Inventory**
`STOCK_IN_TRADE_WAREHOUSE` → `STOCK_IN_TRADE_STORES` → `COST_OF_GOODS_SOLD` *(after COA gap resolved)*

**Phase 4 — POS Vouchers & Loyalty**
`CREDIT_VOUCHERS` → `GIFT_VOUCHERS` → `GIFT_VOUCHERS_CORPORATE` → `CLAIM_VOUCHERS` → `EXCHANGE_VOUCHERS` → `ALLIANCE_REWARD`

**Phase 5 — POS Operations**
`CASH_SHORTAGE_OVERAGE` → `POS_INTEGRATION_FEE_PAYABLE` → `POS_INTEGRATION_FEE_EXPENSE` → `BANK_COMMISSION_SELLING`

**Phase 6 — Payroll** *(after payroll journal posting is built)*
All 11 payroll keys: `SALARIES_EXPENSE_ADMIN/SELLING` → `EOBI_EXPENSE_*` → `PF_EXPENSE_*` → `AP_SALARIES` → `AP_EOBI` → `AP_PROVIDENT_FUND` → `AP_SESSI` → `WHT_SALARY`

**Phase 7 — Financial Charges** *(after COA gaps resolved)*
`BANK_CHARGES` → `MARKUP_ON_LOAN` → `BANK_CHARGES_IMPORT` → `EXCHANGE_LOSS_IMPORT`
