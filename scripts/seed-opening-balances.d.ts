import 'dotenv/config';
interface OpeningBalanceEntry {
    code: string;
    name: string;
    type: 'DEBIT' | 'CREDIT';
    amount: number;
}
export declare const equityOpeningBalances: OpeningBalanceEntry[];
export declare const liabilitiesOpeningBalances: OpeningBalanceEntry[];
export {};
