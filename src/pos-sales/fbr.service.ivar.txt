import { Injectable, Logger } from '@nestjs/common';

/**
 * FBR Software Fiscal Component - Item Model
 * (As specified in FBR Tier 1 Retailer Integration Documentation - Table 2)
 */
export interface FbrImsInvoiceItem {
    ItemCode: string;          // varchar(50) — Compulsory (e.g. Item SKU/code)
    ItemName: string;          // varchar(150) — Compulsory
    PCTCode: string;           // varchar(8) — Compulsory (<= 8 chars, e.g. "01011000")
    Quantity: number;          // double — Compulsory
    TaxRate: number;           // float — Compulsory (e.g. 17 or 18)
    SaleValue: number;         // double — Compulsory (Actual Sale Price excl. tax & discount)
    Discount?: number;         // double — Optional
    FurtherTax?: number;       // double — Optional
    TaxCharged: number;        // double — Compulsory (Actual Tax)
    TotalAmount: number;       // double — Compulsory (Line Total incl. tax)
    InvoiceType: number;       // int — Compulsory (1: New, 3: Credit, 11: 3rd Schedule New, 12: 3rd Schedule Credit)
    RefUSIN?: string | null;   // varchar — Optional (Reference USIN for Credit/Debit note)
}

/**
 * FBR Software Fiscal Component - Invoice Payload
 * (As specified in FBR Tier 1 Retailer Integration Documentation)
 */
export interface FbrImsInvoicePayload {
    InvoiceNumber: string;     // varchar(30) — Blank string "" for new invoice
    POSID: number;             // bigint — Compulsory (POS Registration Number given by FBR)
    USIN: string;              // varchar(50) — Compulsory (Unique Sales Invoice Number)
    DateTime: string;          // datetime — Compulsory ("YYYY-MM-DD HH:mm:ss")
    BuyerNTN?: string | null;  // varchar(9) — Optional
    BuyerCNIC?: string | null; // varchar(13) — Optional
    BuyerName?: string | null; // varchar(150) — Optional
    BuyerPhoneNumber?: string | null; // varchar(20) — Optional
    TotalSaleValue: number;    // double — Compulsory (Sum of Item Sale Values excl. tax & discount)
    TotalTaxCharged: number;   // double — Compulsory (Sum of Item Tax)
    TotalQuantity: number;     // double — Compulsory (Total Quantity of items)
    Discount: number;          // double — Optional (Sum of Item Discounts)
    FurtherTax: number;        // double — Optional (Sum of Further Tax)
    TotalBillAmount: number;   // double — Compulsory (Total Bill Amount incl. tax)
    PaymentMode: number;       // int — Compulsory (1: Cash, 2: Card, 3: Gift Voucher, 4: Loyalty Card, 5: Mixed, 6: Cheque)
    RefUSIN?: string | null;   // varchar(50) — Optional
    InvoiceType: number;       // int — Compulsory (1: New, 2: Debit, 3: Credit)
    Items: FbrImsInvoiceItem[];// list — Compulsory
}

// Backward-compatibility aliases
export type FbrInvoiceItem = FbrImsInvoiceItem;
export type FbrInvoicePayload = FbrImsInvoicePayload;

export interface FbrApiResponse {
    Code?: number | string;      // "100" or 100 = success
    InvoiceNumber?: string;
    FBRInvoiceNumber?: string | number;
    Response?: string;
    Errors?: string | null;
    QRCode?: string;
}

@Injectable()
export class FbrService {
    private readonly logger = new Logger(FbrService.name);

    // Endpoints as per FBR Specification:
    // Cloud Sandbox: https://esp.fbr.gov.pk:8244/imsp/v1/api/Live/PostData
    // Cloud Production: https://gw.fbr.gov.pk/imsp/v1/api/Live/PostData
    private readonly defaultUrl =
        process.env.FBR_API_URL ||
        'https://esp.fbr.gov.pk:8244/imsp/v1/api/Live/PostData';

    private readonly bearerToken = process.env.FBR_BEARER_TOKEN || '';

    /**
     * Posts the fiscalized invoice payload to FBR Software Fiscal Component or Cloud Endpoint
     */
    async postInvoice(
        payload: FbrImsInvoicePayload,
        overrideUrl?: string,
        bearerToken?: string,
    ): Promise<FbrApiResponse> {
        const url = overrideUrl || this.defaultUrl;
        const token = bearerToken || this.bearerToken;

        this.logger.log(`[FBR API] Posting IMS invoice payload for USIN ${payload.USIN} to ${url}`);
        this.logger.debug(`[FBR API] Request Payload:\n${JSON.stringify(payload, null, 2)}`);

        const isHttps = url.startsWith('https://');
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const fetchOptions: any = {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(20000),
            };

            if (isHttps && (url.includes('esp.fbr.gov.pk') || url.includes('fbr.gov.pk'))) {
                fetchOptions.tls = { rejectUnauthorized: false };
            }

            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
                const errorText = await response.text();
                this.logger.error(`[FBR API] HTTP Error ${response.status}: ${errorText}`);
                throw new Error(`FBR HTTP ${response.status}: ${errorText}`);
            }

            const jsonResponse = (await response.json()) as FbrApiResponse;
            this.logger.log(`[FBR API] Response received. Code: ${jsonResponse.Code}, Response: ${jsonResponse.Response ?? ''}`);
            this.logger.debug(`[FBR API] Response Payload:\n${JSON.stringify(jsonResponse, null, 2)}`);

            return jsonResponse;
        } catch (error: any) {
            this.logger.error(`[FBR API] Request failed for USIN ${payload.USIN}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Build the FBR IMS payload from a completed sales order + line items
     * strictly following FBR Software Fiscal Component specification.
     */
    buildPayload(params: {
        posId: string | number;
        usin: string;
        orderDate: Date;
        buyerNtn?: string | null;
        buyerCnic?: string | null;
        buyerName?: string | null;
        buyerPhone?: string | null;
        paymentMode?: number; // 1=Cash, 2=Card, 3=Gift Voucher, 4=Loyalty Card, 5=Mixed, 6=Cheque
        invoiceType?: number; // 1=New, 2=Debit, 3=Credit
        refUsin?: string | null;
        items: Array<{
            itemId: string;
            sku: string;
            description: string | null;
            hsCode: string | null;
            pctCode?: string | null;
            quantity: number;
            unitPrice: number;       // retail price (tax-inclusive)
            taxPercent: number;      // e.g. 18
            discountAmount: number;  // discount applied on WOST
            taxAmount: number;       // tax on amount after discount
            lineTotal: number;       // Value Including Sales Tax
        }>;
    }): FbrImsInvoicePayload {
        const posIdNumber = typeof params.posId === 'number' ? params.posId : parseInt(params.posId, 10) || 0;
        const dateTimeStr = this.formatFbrDateTime(params.orderDate);
        const invType = params.invoiceType ?? 1;

        const isNonZeroHsCode = (str?: string | null): boolean => {
            if (!str) return false;
            const cleaned = str.replace(/[^0-9]/g, '');
            return cleaned.length > 0 && !/^0+$/.test(cleaned);
        };

        const items: FbrImsInvoiceItem[] = params.items.map((item) => {
            // PCT Code must be numeric string <= 8 chars (e.g., '01011000' or '00000000')
            // Prioritize valid non-zero PCT/HS code over placeholder zero strings ('000000')
            const rawHsCode = isNonZeroHsCode(item.pctCode)
                ? item.pctCode
                : isNonZeroHsCode(item.hsCode)
                    ? item.hsCode
                    : item.pctCode || item.hsCode;

            const pctCode = this.formatPctCode(rawHsCode);

            // Calculate WOST (Value Excl. Tax & Discount)
            const taxDivisor = 1 + (item.taxPercent / 100);
            const wostPerUnit = item.unitPrice / taxDivisor;
            const totalWost = wostPerUnit * item.quantity;

            // Amount after discount (value excl. tax, after discount)
            const saleValue = Math.max(0, Math.round((totalWost - item.discountAmount) * 100) / 100);
            const taxCharged = Math.round(item.taxAmount * 100) / 100;
            const discount = Math.round(item.discountAmount * 100) / 100;
            const totalAmount = Math.round((saleValue + taxCharged) * 100) / 100;

            const itemInvoiceType = invType === 3 ? 3 : 1;
            const rawName = item.description || item.sku || 'Item';
            const cleanName = rawName.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();

            return {
                ItemCode: item.sku || item.itemId,
                ItemName: cleanName.substring(0, 150) || 'Item',
                PCTCode: pctCode,
                Quantity: item.quantity,
                TaxRate: item.taxPercent,
                SaleValue: saleValue,
                Discount: discount,
                FurtherTax: 0,
                TaxCharged: taxCharged,
                TotalAmount: totalAmount,
                InvoiceType: itemInvoiceType,
                RefUSIN: params.refUsin || null,
            };
        });

        const totalSaleValue = Math.round(items.reduce((acc, i) => acc + i.SaleValue, 0) * 100) / 100;
        const totalTaxCharged = Math.round(items.reduce((acc, i) => acc + i.TaxCharged, 0) * 100) / 100;
        const totalQuantity = Math.round(items.reduce((acc, i) => acc + i.Quantity, 0) * 100) / 100;
        const totalDiscount = Math.round(items.reduce((acc, i) => acc + (i.Discount || 0), 0) * 100) / 100;
        const totalBillAmount = Math.round(items.reduce((acc, i) => acc + i.TotalAmount, 0) * 100) / 100;

        return {
            InvoiceNumber: '',
            POSID: posIdNumber,
            USIN: params.usin,
            DateTime: dateTimeStr,
            BuyerNTN: params.buyerNtn || null,
            BuyerCNIC: params.buyerCnic || null,
            BuyerName: params.buyerName || 'Guest',
            BuyerPhoneNumber: params.buyerPhone || null,
            TotalSaleValue: totalSaleValue,
            TotalTaxCharged: totalTaxCharged,
            TotalQuantity: totalQuantity,
            Discount: totalDiscount,
            FurtherTax: 0,
            TotalBillAmount: totalBillAmount,
            PaymentMode: params.paymentMode ?? 1, // Default 1 = Cash
            RefUSIN: params.refUsin || null,
            InvoiceType: invType,
            Items: items,
        };
    }

    /**
     * Formats PCT/HS Code to match FBR requirement (<= 8 numeric characters).
     */
    private formatPctCode(hsCode: string | null | undefined): string {
        if (!hsCode) return '00000000';
        const cleaned = hsCode.replace(/[^0-9]/g, '');
        if (!cleaned || /^0+$/.test(cleaned)) return '00000000';
        return cleaned.substring(0, 8).padEnd(8, '0');
    }

    /**
     * Formats date as YYYY-MM-DD HH:mm:ss for FBR DateTime field.
     */
    private formatFbrDateTime(date: Date): string {
        const pad = (n: number) => n.toString().padStart(2, '0');
        const yyyy = date.getFullYear();
        const mm = pad(date.getMonth() + 1);
        const dd = pad(date.getDate());
        const hh = pad(date.getHours());
        const mi = pad(date.getMinutes());
        const ss = pad(date.getSeconds());
        return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
    }
}

