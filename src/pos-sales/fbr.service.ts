import { Injectable, Logger } from '@nestjs/common';

export interface FbrInvoiceItem {
    hsCode: string;       // PCTCode — default '0000.0000'
    productCode: string;
    productDescription: string;
    rate: number;         // unit price excl. tax
    uoM: number;          // Unit of Measure (1 = Each)
    quantity: number;
    valueSalesExcludingST: number;
    salesTaxApplicable: number;
    retailPrice: number;
    stWithheldAtSource: number;
    extraTax: number;
    furtherTax: number;
    sroScheduleNo: number;
    fedPayable: number;
    cvt: number;
    whiT_1: number;
    whiT_2: number;
    whiT_Section_1: string;
    whiT_Section_2: string;
    totalValues: number;
}

export interface FbrInvoicePayload {
    bposId: string;
    usin: string;              // Unique Sales Invoice Number (order ID)
    invoiceType: string;       // '1' = sale
    invoiceDate: string;       // YYYY-MM-DD
    ntN_CNIC: string;          // buyer NTN/CNIC; '9999999-9' for walk-in
    buyerSellerName: string;
    destinationAddress: string;
    saleType: number;          // 1 = retail
    totalSalesTaxApplicable: number;
    totalRetailPrice: number;
    totalSTWithheldAtSource: number;
    totalExtraTax: number;
    totalFEDPayable: number;
    totalWithheldIncomeTax: number;
    totalCVT: number;
    distributor_NTN_CNIC: string;
    distributorName: string;
    invoiceItemDetails: FbrInvoiceItem[];
}

export interface FbrApiResponse {
    Code: number;           // 100 = success
    InvoiceNumber?: string;
    QRCode?: string;
    Errors?: string;
}

@Injectable()
export class FbrService {
    private readonly logger = new Logger(FbrService.name);

    // Sandbox: https://esp.fbr.gov.pk:8244/DigitalInvoicing/v1/PostInvoiceData_v1
    // Production: https://gw.fbr.gov.pk/pdi/v1/api/DigitalInvoicing/PostInvoiceData_v1
    private readonly sandboxUrl =
        process.env.FBR_API_URL ||
        'https://esp.fbr.gov.pk:8244/DigitalInvoicing/v1/PostInvoiceData_v1';

    private readonly bearerToken = process.env.FBR_BEARER_TOKEN || '';

    async postInvoice(payload: FbrInvoicePayload, bearerToken?: string): Promise<FbrApiResponse> {
        const token = bearerToken || this.bearerToken;
        const url = this.sandboxUrl;

        this.logger.log(`[FBR API] Posting invoice payload for USIN ${payload.usin} to ${url}`);
        this.logger.debug(`[FBR API] Request Payload:\n${JSON.stringify(payload, null, 2)}`);

        const isSandbox = url.includes('esp.fbr.gov.pk');

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
                // Bun-specific native TLS bypass for self-signed certificates
                ...(isSandbox ? { tls: { rejectUnauthorized: false } } : {}),
            } as any);

            if (!response.ok) {
                const errorText = await response.text();
                this.logger.error(`[FBR API] HTTP Error ${response.status}: ${errorText}`);
                throw new Error(`FBR HTTP ${response.status}: ${errorText}`);
            }

            const jsonResponse = await response.json() as FbrApiResponse;
            this.logger.log(`[FBR API] Response received. Code: ${jsonResponse.Code}`);
            this.logger.debug(`[FBR API] Response Payload:\n${JSON.stringify(jsonResponse, null, 2)}`);
            
            return jsonResponse;
        } catch (error: any) {
            this.logger.error(`[FBR API] Request failed for USIN ${payload.usin}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Build the FBR payload from a completed sales order + computed line items.
     *
     * Receipt logic reference (print-receipt.tsx):
     *   WOST (Value Excl. Tax) = retailPrice / (1 + taxPercent/100)
     *   Discount applied on WOST → Amount after Discount
     *   Tax = Amount after Discount × taxPercent/100
     *   Value Including Sales Tax = Amount after Discount + Tax
     *
     * FBR field mapping:
     *   rate                  = WOST per unit (tax-exclusive)
     *   valueSalesExcludingST = WOST after discount (Amount after Discount)
     *   salesTaxApplicable    = Tax on amount after discount
     *   retailPrice           = Value Including Sales Tax
     *   totalValues           = Value Including Sales Tax
     */
    buildPayload(params: {
        bposId: string;
        usin: string;
        orderDate: Date;
        buyerNtn: string;
        buyerName: string;
        buyerAddress: string;
        sellerNtn: string;
        sellerName: string;
        items: Array<{
            itemId: string;
            sku: string;
            description: string | null;
            hsCode: string | null;
            quantity: number;
            unitPrice: number;       // retail price (tax-inclusive)
            taxPercent: number;      // e.g. 18
            discountAmount: number;  // discount applied on WOST
            taxAmount: number;       // tax on amount after discount
            lineTotal: number;       // Value Including Sales Tax
        }>;
    }): FbrInvoicePayload {
        const invoiceDate = params.orderDate.toISOString().split('T')[0];

        const invoiceItemDetails: FbrInvoiceItem[] = params.items.map((item) => {
            // WOST = Retail Price / (1 + tax%)
            const taxDivisor = 1 + (item.taxPercent / 100);
            const wostPerUnit = Math.round((item.unitPrice / taxDivisor) * 100) / 100;
            const totalWost = Math.round(wostPerUnit * item.quantity * 100) / 100;

            // Amount after discount (value excl. tax, after discount)
            const valueSalesExcludingST = Math.round((totalWost - item.discountAmount) * 100) / 100;

            // Value Including Sales Tax = valueSalesExcludingST + salesTaxApplicable
            const valueIncludingST = Math.round((valueSalesExcludingST + item.taxAmount) * 100) / 100;

            return {
                hsCode: item.hsCode || '0000.0000',
                productCode: item.sku,
                productDescription: item.description || item.sku,
                rate: wostPerUnit,           // tax-exclusive unit price
                uoM: 1,
                quantity: item.quantity,
                valueSalesExcludingST,        // post-discount, pre-tax
                salesTaxApplicable: item.taxAmount,
                retailPrice: valueIncludingST, // Value Including Sales Tax
                stWithheldAtSource: 0,
                extraTax: 0,
                furtherTax: 0,
                sroScheduleNo: 999999999,
                fedPayable: 0,
                cvt: 0,
                whiT_1: 0,
                whiT_2: 0,
                whiT_Section_1: '',
                whiT_Section_2: '',
                totalValues: valueIncludingST, // = retailPrice
            };
        });

        const totalSalesTaxApplicable = invoiceItemDetails.reduce(
            (acc, i) => acc + i.salesTaxApplicable,
            0,
        );
        const totalRetailPrice = invoiceItemDetails.reduce(
            (acc, i) => acc + i.retailPrice,
            0,
        );

        return {
            bposId: params.bposId,
            usin: params.usin,
            invoiceType: '1',
            invoiceDate,
            ntN_CNIC: params.buyerNtn,
            buyerSellerName: params.buyerName,
            destinationAddress: params.buyerAddress,
            saleType: 1,
            totalSalesTaxApplicable,
            totalRetailPrice,
            totalSTWithheldAtSource: 0,
            totalExtraTax: 0,
            totalFEDPayable: 0,
            totalWithheldIncomeTax: 0,
            totalCVT: 0,
            distributor_NTN_CNIC: params.sellerNtn,
            distributorName: params.sellerName,
            invoiceItemDetails,
        };
    }
}
