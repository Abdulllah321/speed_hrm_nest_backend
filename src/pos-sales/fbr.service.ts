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

    private readonly sandboxUrl =
        process.env.FBR_API_URL ||
        'https://esp.fbr.gov.pk/DigitalInvoicing/v1/PostInvoiceData_v1';

    private readonly bearerToken = process.env.FBR_BEARER_TOKEN || '';

    async postInvoice(payload: FbrInvoicePayload, bearerToken?: string): Promise<FbrApiResponse> {
        const token = bearerToken || this.bearerToken;
        const response = await fetch(this.sandboxUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`FBR HTTP ${response.status}: ${await response.text()}`);
        }

        return response.json() as Promise<FbrApiResponse>;
    }

    /**
     * Build the FBR payload from a completed sales order + computed line items.
     */
    buildPayload(params: {
        bposId: string;
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
            unitPrice: number;
            taxAmount: number;
            lineTotal: number;
        }>;
    }): FbrInvoicePayload {
        const invoiceDate = params.orderDate.toISOString().split('T')[0];

        const invoiceItemDetails: FbrInvoiceItem[] = params.items.map((item) => {
            const valueSalesExcludingST = Math.round(item.unitPrice * item.quantity * 100) / 100;
            return {
                hsCode: item.hsCode || '0000.0000',
                productCode: item.sku,
                productDescription: item.description || item.sku,
                rate: item.unitPrice,
                uoM: 1,
                quantity: item.quantity,
                valueSalesExcludingST,
                salesTaxApplicable: item.taxAmount,
                retailPrice: item.lineTotal,
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
                totalValues: item.lineTotal,
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
