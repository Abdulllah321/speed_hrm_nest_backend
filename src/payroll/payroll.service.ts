import { Injectable, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class PayrollService {
    private readonly logger = new Logger(PayrollService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly activityLogsService: ActivityLogsService
    ) { }

    async previewPayroll(month: string, year: string, employeeIds?: string[]) {
        this.logger.log(`Previewing payroll for ${month}/${year}`);

        // 1. Fetch active employees
        const whereClause: Prisma.EmployeeWhereInput = { status: 'active' };
        if (employeeIds && employeeIds.length > 0) {
            whereClause.id = { in: employeeIds };
        }

        const employees = await this.prisma.employee.findMany({
            where: whereClause,
            include: {
                workingHoursPolicy: true,
                leavesPolicy: true,
                allowances: {
                    where: { status: 'active', month, year },
                    include: { allowanceHead: { select: { id: true, name: true } } }
                },
                deductions: {
                    where: { status: 'active', month, year },
                    include: { deductionHead: { select: { id: true, name: true } } }
                },
                loanRequests: { where: { status: 'approved' } },
                advanceSalaries: { where: { deductionMonth: month, deductionYear: year, status: 'approved' } },
                bonuses: { 
                    where: { bonusMonth: month, bonusYear: year, status: 'active' },
                    include: { bonusType: { select: { id: true, name: true } } }
                },
                rebates: { where: { monthYear: `${year}-${month}`, status: 'approved' }, include: { rebateNature: true } },
                leaveApplications: { 
                    where: { 
                        status: 'approved',
                        OR: [
                            {
                                fromDate: { lte: new Date(Number(year), Number(month), 0) },
                                toDate: { gte: new Date(`${year}-${month}-01`) }
                            }
                        ]
                    },
                    select: {
                        id: true,
                        fromDate: true,
                        toDate: true,
                        status: true,
                    }
                },
            },
        });

        if (employees.length === 0) {
            throw new BadRequestException("No active employees found to generate payroll for.");
        }

        const salaryBreakups = await this.prisma.salaryBreakup.findMany({
            where: { status: 'active' }
        });

        const previewData: any[] = []; // Explicitly type as any[] or define an interface

        for (const employee of employees) {
            // "employeeSalary" is treated as the Total Monthly Package (Gross before ad-hoc)
            const packageAmount = new Decimal(employee.employeeSalary);

            // Calculate breakup components
            const salaryBreakup = salaryBreakups.map(breakup => {
                let amount = new Decimal(0);
                if (breakup.percentage !== null && breakup.percentage !== undefined) {
                    amount = packageAmount.mul(new Decimal(breakup.percentage)).div(100);
                }
                return {
                    id: breakup.id,
                    name: breakup.name,
                    percentage: breakup.percentage ? new Decimal(breakup.percentage).toNumber() : null,
                    amount: amount.toNumber()
                };
            });

            // Find "Basic Salary" component for rate calculations
            const basicComponent = salaryBreakup.find(b => b.name === 'Basic Salary');
            const calculatedBasicSalary = basicComponent ? new Decimal(basicComponent.amount) : packageAmount; // Fallback to package if no basic defined

            // A. Calculate Allowances (Ad-hoc additional allowances)
            const totalAdHocAllowances = this.calculateAllowances(employee.allowances);
            
            // Prepare allowance breakdown
            const allowanceBreakup = employee.allowances.map((allow) => ({
                id: allow.id,
                name: allow.allowanceHead?.name || 'Unknown',
                amount: Number(allow.amount),
                isTaxable: allow.isTaxable,
                taxPercentage: allow.taxPercentage ? Number(allow.taxPercentage) : null,
            }));

            // B. Calculate Overtime (Using calculated Basic Salary for rate)
            const { overtimeAmount, overtimeBreakup } = await this.calculateOvertime(employee, month, year, employee.workingHoursPolicy, calculatedBasicSalary);

            // C. Calculate Attendance Deductions (Lates/Absents) (using calculated Basic Salary for rate)
            const { attendanceDeduction, attendanceBreakup } = await this.calculateAttendanceDeductions(employee, month, year, employee.workingHoursPolicy, calculatedBasicSalary);

            // D. Calculate Bonuses
            const bonusAmount = this.calculateBonuses(employee.bonuses);
            
            // Prepare bonus breakdown (only bonuses with paymentMethod 'with_salary')
            const bonusBreakup = employee.bonuses
                .filter(b => b.paymentMethod === 'with_salary')
                .map((bonus) => ({
                    id: bonus.id,
                    name: bonus.bonusType?.name || 'Unknown',
                    amount: Number(bonus.amount),
                    calculationType: bonus.calculationType,
                    percentage: bonus.percentage ? Number(bonus.percentage) : null,
                }));
            
            // Prepare deduction breakdown (excluding tax, attendance, loan, advance, eobi, pf which are calculated separately)
            const deductionBreakup = employee.deductions.map((ded) => ({
                id: ded.id,
                name: ded.deductionHead?.name || 'Unknown',
                amount: Number(ded.amount),
                isTaxable: ded.isTaxable,
                taxPercentage: ded.taxPercentage ? Number(ded.taxPercentage) : null,
            }));

            // E. Calculate Gross Salary (Pre-tax)
            // Gross = Sum of Salary Breakup Components + AdHoc Allowances + Overtime + Bonus
            // Calculate total from salary breakup components
            const salaryBreakupTotal = salaryBreakup.reduce((sum, component) => sum + (component.amount || 0), 0);
            const grossSalary = new Decimal(salaryBreakupTotal || packageAmount.toNumber()).add(totalAdHocAllowances).add(overtimeAmount).add(bonusAmount);

            // F. Calculate Tax (with Rebates)
            const { taxDeduction, taxBreakup } = await this.calculateTax(grossSalary, employee.rebates);

            // G. Calculate EOBI & PF
            const { eobiDeduction, providentFundDeduction } = this.calculateEOBI_PF(employee);

            // H. Calculate Loans & Advances
            const { loanDeduction, advanceSalaryDeduction } = this.calculateLoansAndAdvances(employee, month, year);

            // I. Other Ad-hoc Deductions
            const totalAdHocDeductions = this.calculateAdHocDeductions(employee.deductions);

            // Total Deductions
            const totalDeductionsSum = attendanceDeduction
                .add(loanDeduction)
                .add(advanceSalaryDeduction)
                .add(eobiDeduction)
                .add(providentFundDeduction)
                .add(taxDeduction)
                .add(totalAdHocDeductions);

            // Net Salary
            const netSalary = grossSalary.minus(totalDeductionsSum);

            // Push to array (plain objects for frontend)
            previewData.push({
                employeeId: employee.id,
                employeeName: employee.employeeName,
                employeeCode: employee.employeeId,
                basicSalary: calculatedBasicSalary.toNumber(),
                salaryBreakup,
                allowanceBreakup,
                totalAllowances: totalAdHocAllowances.toNumber(),
                overtimeBreakup,
                overtimeAmount: overtimeAmount.toNumber(),
                bonusBreakup,
                bonusAmount: bonusAmount.toNumber(),
                deductionBreakup,
                totalDeductions: totalAdHocDeductions.toNumber(),
                attendanceBreakup,
                attendanceDeduction: attendanceDeduction.toNumber(),
                loanDeduction: loanDeduction.toNumber(),
                advanceSalaryDeduction: advanceSalaryDeduction.toNumber(),
                eobiDeduction: eobiDeduction.toNumber(),
                providentFundDeduction: providentFundDeduction.toNumber(),
                taxBreakup,
                taxDeduction: taxDeduction.toNumber(),
                grossSalary: grossSalary.toNumber(),
                netSalary: netSalary.toNumber(),
                paymentStatus: 'pending',
            });
        }

        return previewData;
    }

    async confirmPayroll(data: {
        month: string;
        year: string;
        generatedBy: string;
        details: any[]; // Edited list from frontend
    }) {
        const { month, year, generatedBy, details } = data;
        this.logger.log(`Confirming payroll for ${month}/${year}`);

        try {
            // Check if payroll already exists
            let payroll = await this.prisma.payroll.findFirst({
                where: {
                    month,
                    year,
                },
            });

            if (payroll) {
                if (payroll.status !== 'draft') {
                    throw new BadRequestException('Payroll for this month is already processed/approved.');
                }
            } else {
                // Create new payroll header if not exists
                payroll = await this.prisma.payroll.create({
                    data: {
                        month,
                        year,
                        totalAmount: 0,
                        status: 'draft',
                        generatedBy: generatedBy ? { connect: { id: generatedBy } } : undefined,
                    }
                });
            }

            // Remove existing details for submitted employees
            const employeeIds = details.map(d => d.employeeId);
            await this.prisma.payrollDetail.deleteMany({
                where: {
                    payrollId: payroll.id,
                    employeeId: { in: employeeIds }
                }
            });

            const payrollDetailsData: any[] = details.map(d => ({
                payrollId: payroll.id,
                employeeId: d.employeeId,
                basicSalary: new Decimal(d.basicSalary),
                totalAllowances: new Decimal(d.totalAllowances),
                totalDeductions: new Decimal(d.totalDeductions),
                attendanceDeduction: new Decimal(d.attendanceDeduction),
                loanDeduction: new Decimal(d.loanDeduction),
                advanceSalaryDeduction: new Decimal(d.advanceSalaryDeduction),
                eobiDeduction: new Decimal(d.eobiDeduction),
                providentFundDeduction: new Decimal(d.providentFundDeduction),
                taxDeduction: new Decimal(d.taxDeduction),
                overtimeAmount: new Decimal(d.overtimeAmount),
                bonusAmount: new Decimal(d.bonusAmount),
                grossSalary: new Decimal(d.grossSalary),
                netSalary: new Decimal(d.netSalary),
                paymentStatus: 'pending',
            }));

            // Bulk create details
            if (payrollDetailsData.length > 0) {
                await this.prisma.payrollDetail.createMany({
                    data: payrollDetailsData,
                });
            }

            // Update Total Amount
            const aggregate = await this.prisma.payrollDetail.aggregate({
                where: { payrollId: payroll.id },
                _sum: { netSalary: true }
            });

            await this.prisma.payroll.update({
                where: { id: payroll.id },
                data: { totalAmount: aggregate._sum.netSalary || new Decimal(0) }
            });

            // Log Component
            await this.activityLogsService.log({
                module: "payroll",
                action: "generate",
                entity: "Payroll",
                entityId: payroll.id,
                description: `Confirmed payroll for ${month}/${year}`,
                status: "success",
                userId: generatedBy,
            });

            return payroll;
        } catch (error) {
            this.logger.error(`Error confirming payroll: ${error.message}`, error.stack);

            // Log failure to activity logs
            await this.activityLogsService.log({
                module: "payroll",
                action: "generate",
                entity: "Payroll",
                description: `Failed to confirm payroll for ${month}/${year}: ${error.message}`,
                status: "failure",
                userId: generatedBy,
                errorMessage: error.message
            });

            throw error instanceof BadRequestException ? error : new InternalServerErrorException(error.message);
        }
    }

    async getPayrollById(id: string) {
        return this.prisma.payroll.findUnique({
            where: { id },
            include: { details: { include: { employee: true } } }
        })
    }

    // --- Helper Methods ---

    private calculateAllowances(allowances: any[]): Decimal {
        // Sum up allowance amounts
        return allowances.reduce((sum, allow) => sum.add(new Decimal(allow.amount)), new Decimal(0));
    }

    private calculateBonuses(bonuses: any[]): Decimal {
        // Filter for paymentMethod 'with_salary'
        return bonuses
            .filter(b => b.paymentMethod === 'with_salary')
            .reduce((sum, b) => sum.add(new Decimal(b.amount)), new Decimal(0));
    }

    private calculateAdHocDeductions(deductions: any[]): Decimal {
        return deductions.reduce((sum, ded) => sum.add(new Decimal(ded.amount)), new Decimal(0));
    }

    private calculateEOBI_PF(employee: any) {
        let eobiDeduction = new Decimal(0);
        let providentFundDeduction = new Decimal(0);

        // Placeholder: Assuming fixed amount or configured via separate check. 
        // In a real scenario, this would fetch from a configuration table.
        if (employee.eobi) {
            eobiDeduction = new Decimal(0); // TODO: Fetch from EOBI Master
        }

        if (employee.providentFund) {
            providentFundDeduction = new Decimal(0); // TODO: Fetch from PF Master
        }

        return { eobiDeduction, providentFundDeduction };
    }

    private calculateLoansAndAdvances(employee: any, month: string, year: string) {
        let loanDeduction = new Decimal(0);
        let advanceSalaryDeduction = new Decimal(0);

        // Loans
        if (employee.loanRequests) {
            for (const loan of employee.loanRequests) {
                if (loan.repaymentStartMonthYear && loan.numberOfInstallments) {
                    const [startYear, startMonth] = loan.repaymentStartMonthYear.split('-').map(Number);
                    const currentY = Number(year);
                    const currentM = Number(month);

                    const diffMonths = (currentY - startYear) * 12 + (currentM - startMonth);
                    if (diffMonths >= 0 && diffMonths < loan.numberOfInstallments) {
                        const installment = new Decimal(loan.amount).div(loan.numberOfInstallments);
                        loanDeduction = loanDeduction.add(installment);
                    }
                }
            }
        }

        // Advances
        if (employee.advanceSalaries) {
            for (const advance of employee.advanceSalaries) {
                advanceSalaryDeduction = advanceSalaryDeduction.add(new Decimal(advance.amount));
            }
        }

        return { loanDeduction, advanceSalaryDeduction };
    }

    private async calculateAttendanceDeductions(employee: any, month: string, year: string, policy: any, basicSalary: Decimal): Promise<{ attendanceDeduction: Decimal; attendanceBreakup: any }> {
        const startDate = new Date(`${year}-${month}-01`);
        const endDate = new Date(Number(year), Number(month), 0);

        const attendances = await this.prisma.attendance.findMany({
            where: {
                employeeId: employee.id,
                date: {
                    gte: startDate,
                    lte: endDate,
                }
            }
        });

        let deduction = new Decimal(0);
        let lateCount = 0;
        let absentCount = 0;
        let halfDayCount = 0;
        let shortDayCount = 0;

        // Calculate per day salary (assuming 30 days)
        const perDaySalary = basicSalary.div(30);

        // Helper function to check if date has approved leave
        const hasApprovedLeave = (date: Date): boolean => {
            if (!employee.leaveApplications || employee.leaveApplications.length === 0) return false;
            
            const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            
            return employee.leaveApplications.some((leave: any) => {
                const fromDate = new Date(leave.fromDate);
                const toDate = new Date(leave.toDate);
                fromDate.setHours(0, 0, 0, 0);
                toDate.setHours(23, 59, 59, 999);
                
                return dateOnly >= fromDate && dateOnly <= toDate;
            });
        };

        // Count leave days
        let leaveDaysCount = 0;
        const totalDaysInMonth = new Date(Number(year), Number(month), 0).getDate();
        
        // Process attendances
        for (const att of attendances) {
            const attDate = new Date(att.date);
            const hasLeave = hasApprovedLeave(attDate);

            if (hasLeave) {
                leaveDaysCount++;
            }

            if (att.status === 'absent' && !hasLeave) {
                absentCount++;
            } else if (att.status === 'late' || (att.lateMinutes && att.lateMinutes > 0)) {
                lateCount++;
            } else if (att.status === 'half-day' && !hasLeave) {
                halfDayCount++;
            } else if (att.status === 'short-day' && !hasLeave) {
                shortDayCount++;
            }
        }

        // Calculate total working days in month for absent deduction
        // If no attendance records exist at all for the month, consider all days as absent (if no leave)
        if (attendances.length === 0) {
            // Check how many days have approved leave
            for (let day = 1; day <= totalDaysInMonth; day++) {
                const checkDate = new Date(Number(year), Number(month) - 1, day);
                if (hasApprovedLeave(checkDate)) {
                    leaveDaysCount++;
                }
            }
            absentCount = totalDaysInMonth - leaveDaysCount;
        }

        // Calculate individual deduction amounts
        const absentDeductionAmount = perDaySalary.mul(absentCount);
        let halfDayDeductionAmount = new Decimal(0);
        let shortDayDeductionAmount = new Decimal(0);
        let lateDeductionAmount = new Decimal(0);

        // Absent Deduction - Full day salary per absent day
        deduction = deduction.add(absentDeductionAmount);

        // Half Day Deduction
        if (policy && policy.halfDayDeductionType && policy.halfDayDeductionAmount && halfDayCount > 0) {
            if (policy.applyDeductionAfterHalfDays && halfDayCount >= policy.applyDeductionAfterHalfDays) {
                const chargeableHalfDays = Math.max(0, halfDayCount - (policy.applyDeductionAfterHalfDays || 0));
                if (chargeableHalfDays > 0) {
                    if (policy.halfDayDeductionType === 'amount') {
                        halfDayDeductionAmount = new Decimal(policy.halfDayDeductionAmount).mul(chargeableHalfDays);
                        deduction = deduction.add(halfDayDeductionAmount);
                    } else if (policy.halfDayDeductionType === 'percentage') {
                        halfDayDeductionAmount = perDaySalary.mul(new Decimal(policy.halfDayDeductionAmount || 0).div(100)).mul(chargeableHalfDays);
                        deduction = deduction.add(halfDayDeductionAmount);
                    }
                }
            } else if (!policy.applyDeductionAfterHalfDays) {
                // If no threshold, deduct for all half days
                if (policy.halfDayDeductionType === 'amount') {
                    halfDayDeductionAmount = new Decimal(policy.halfDayDeductionAmount).mul(halfDayCount);
                    deduction = deduction.add(halfDayDeductionAmount);
                } else if (policy.halfDayDeductionType === 'percentage') {
                    halfDayDeductionAmount = perDaySalary.mul(new Decimal(policy.halfDayDeductionAmount || 0).div(100)).mul(halfDayCount);
                    deduction = deduction.add(halfDayDeductionAmount);
                }
            }
        }

        // Short Day Deduction
        if (policy && policy.shortDayDeductionType && policy.shortDayDeductionAmount && shortDayCount > 0) {
            if (policy.applyDeductionAfterShortDays && shortDayCount >= policy.applyDeductionAfterShortDays) {
                const chargeableShortDays = Math.max(0, shortDayCount - (policy.applyDeductionAfterShortDays || 0));
                if (chargeableShortDays > 0) {
                    if (policy.shortDayDeductionType === 'amount') {
                        shortDayDeductionAmount = new Decimal(policy.shortDayDeductionAmount).mul(chargeableShortDays);
                        deduction = deduction.add(shortDayDeductionAmount);
                    } else if (policy.shortDayDeductionType === 'percentage') {
                        shortDayDeductionAmount = perDaySalary.mul(new Decimal(policy.shortDayDeductionAmount || 0).div(100)).mul(chargeableShortDays);
                        deduction = deduction.add(shortDayDeductionAmount);
                    }
                }
            } else if (!policy.applyDeductionAfterShortDays) {
                // If no threshold, deduct for all short days
                if (policy.shortDayDeductionType === 'amount') {
                    shortDayDeductionAmount = new Decimal(policy.shortDayDeductionAmount).mul(shortDayCount);
                    deduction = deduction.add(shortDayDeductionAmount);
                } else if (policy.shortDayDeductionType === 'percentage') {
                    shortDayDeductionAmount = perDaySalary.mul(new Decimal(policy.shortDayDeductionAmount || 0).div(100)).mul(shortDayCount);
                    deduction = deduction.add(shortDayDeductionAmount);
                }
            }
        }

        // Late Deduction Logic
        const chargeableLates = policy && policy.applyDeductionAfterLates 
            ? Math.max(0, lateCount - policy.applyDeductionAfterLates)
            : lateCount;
        if (policy && policy.lateDeductionType && chargeableLates > 0 && policy.lateDeductionPercent) {
            const deductionPerLate = perDaySalary.mul(new Decimal(policy.lateDeductionPercent).div(100));
            lateDeductionAmount = deductionPerLate.mul(chargeableLates);
            deduction = deduction.add(lateDeductionAmount);
        }

        // Create attendance breakdown
        const attendanceBreakup = {
            absent: {
                count: absentCount,
                amount: absentDeductionAmount.toNumber(),
            },
            late: {
                count: lateCount,
                chargeableCount: chargeableLates,
                amount: lateDeductionAmount.toNumber(),
            },
            halfDay: {
                count: halfDayCount,
                amount: halfDayDeductionAmount.toNumber(),
            },
            shortDay: {
                count: shortDayCount,
                amount: shortDayDeductionAmount.toNumber(),
            },
            leave: {
                count: leaveDaysCount,
                amount: 0, // Leave doesn't cause deduction, just informational
            },
        };

        return { attendanceDeduction: deduction, attendanceBreakup };
    }

    private async calculateOvertime(employee: any, month: string, year: string, policy: any, basicSalary: Decimal): Promise<{ overtimeAmount: Decimal; overtimeBreakup: any[] }> {
        // Fetch approved OvertimeRequests for this month
        const startDate = new Date(`${year}-${month}-01`);
        const endDate = new Date(Number(year), Number(month), 0);

        const overtimes = await this.prisma.overtimeRequest.findMany({
            where: {
                employeeId: employee.id,
                status: 'approved',
                date: {
                    gte: startDate,
                    lte: endDate,
                }
            },
            orderBy: { date: 'asc' }
        });

        let amount = new Decimal(0);
        const overtimeBreakup: any[] = [];

        if (!employee.overtimeApplicable || !policy) {
            return { overtimeAmount: amount, overtimeBreakup };
        }

        const hourlyRate = basicSalary.div(30).div(8); // Use calculated basic salary
        let rateMultiplier = new Decimal(1);
        if (policy.overtimeRate) {
            rateMultiplier = new Decimal(policy.overtimeRate);
        }

        let holidayMultiplier = rateMultiplier;
        if (policy.gazzetedOvertimeRate) {
            holidayMultiplier = new Decimal(policy.gazzetedOvertimeRate);
        }

        for (const ot of overtimes) {
            const weekdayHours = new Decimal(ot.weekdayOvertimeHours || 0);
            const holidayHours = new Decimal(ot.holidayOvertimeHours || 0);

            const weekdayAmt = hourlyRate.mul(rateMultiplier).mul(weekdayHours);
            const holidayAmt = hourlyRate.mul(holidayMultiplier).mul(holidayHours);

            const otTotal = weekdayAmt.add(holidayAmt);
            amount = amount.add(otTotal);

            if (otTotal.gt(0)) {
                overtimeBreakup.push({
                    id: ot.id,
                    title: ot.title || 'Overtime',
                    date: ot.date,
                    weekdayHours: weekdayHours.toNumber(),
                    holidayHours: holidayHours.toNumber(),
                    amount: otTotal.toNumber(),
                    type: ot.overtimeType,
                });
            }
        }

        return { overtimeAmount: amount, overtimeBreakup };
    }

    private async calculateTax(grossSalary: Decimal, rebates: any[]): Promise<{ taxDeduction: Decimal; taxBreakup: any }> {
        const annualIncome = grossSalary.mul(12);

        let taxableIncome = annualIncome;
        let totalRebateAmount = new Decimal(0);
        const rebateBreakup: any[] = [];

        if (rebates && rebates.length > 0) {
            for (const rebate of rebates) {
                const rebateAmount = new Decimal(rebate.rebateAmount);
                totalRebateAmount = totalRebateAmount.add(rebateAmount);
                taxableIncome = taxableIncome.minus(rebateAmount);
                rebateBreakup.push({
                    id: rebate.id,
                    name: rebate.rebateNature?.name || 'Rebate',
                    amount: rebateAmount.toNumber(),
                });
            }
        }

        let taxDeduction = new Decimal(0);
        let taxSlabUsed = null;

        if (taxableIncome.gt(0)) {
            const slab = await this.prisma.taxSlab.findFirst({
                where: {
                    minAmount: { lte: taxableIncome },
                    maxAmount: { gte: taxableIncome },
                    status: 'active',
                },
                orderBy: { minAmount: 'desc' }
            });

            if (slab) {
                taxSlabUsed = {
                    minAmount: Number(slab.minAmount),
                    maxAmount: Number(slab.maxAmount),
                    rate: Number(slab.rate),
                };

                const excess = taxableIncome.minus(new Decimal(slab.minAmount));
                // Assuming rate is percentage
                const annualTax = excess.mul(new Decimal(slab.rate).div(100));
                taxDeduction = annualTax.div(12);
            }
        }

        const taxBreakup = {
            annualGross: annualIncome.toNumber(),
            totalRebate: totalRebateAmount.toNumber(),
            taxableIncome: taxableIncome.toNumber(),
            taxSlab: taxSlabUsed,
            monthlyTax: taxDeduction.toNumber(),
            rebateBreakup,
        };

        return { taxDeduction, taxBreakup };
    }
}
