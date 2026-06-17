import 'dotenv/config';
export declare const leaveTypesSeed: string[];
export interface LeavePolicySeed {
    id?: string;
    name: string;
    details: string;
    fullDayDeductionRate: number;
    halfDayDeductionRate: number;
    shortLeaveDeductionRate: number;
    isDefault: boolean;
    leaveTypes: {
        name: string;
        numberOfLeaves: number;
    }[];
}
export declare const leavesPoliciesSeed: LeavePolicySeed[];
