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
                increments: {
                    where: {
                        status: 'active',
                        promotionDate: { lte: new Date(Number(year), Number(month), 0) }, // Increments effective on or before the end of payroll month
                    },
                    orderBy: { promotionDate: 'asc' },
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
            const monthStartDate = new Date(`${year}-${month}-01`);
            const monthEndDate = new Date(Number(year), Number(month), 0);
            const totalDaysInMonth = monthEndDate.getDate();

            // Calculate effective salary considering increments/decrements during the month
            const { effectivePackage, incrementBreakup } = this.calculateEffectiveSalary(
                employee,
                monthStartDate,
                monthEndDate,
                totalDaysInMonth
            );

            // "effectivePackage" is the effective monthly package considering increments/decrements
            const packageAmount = effectivePackage;

            // Calculate breakup components using effective package
            // Parse details to get component-level taxability information
            const salaryBreakup = salaryBreakups.map(breakup => {
                let amount = new Decimal(0);
                let isTaxable = false;
                
                // Parse details JSON to check if this component is taxable
                try {
                    if (breakup.details) {
                        const details = typeof breakup.details === 'string' ? JSON.parse(breakup.details) : breakup.details;
                        if (Array.isArray(details) && details.length > 0) {
                            // If details is an array, find the entry matching this breakup's name
                            const matchingEntry = details.find((entry: any) => entry.typeName === breakup.name);
                            if (matchingEntry && matchingEntry.isTaxable) {
                                isTaxable = true;
                            }
                        } else if (typeof details === 'object' && details.isTaxable) {
                            // If details is an object with isTaxable property
                            isTaxable = details.isTaxable === true;
                        }
                    }
                } catch (e) {
                    // If parsing fails, default to not taxable
                    isTaxable = false;
                }
                
                if (breakup.percentage !== null && breakup.percentage !== undefined) {
                    amount = packageAmount.mul(new Decimal(breakup.percentage)).div(100);
                }
                return {
                    id: breakup.id,
                    name: breakup.name,
                    percentage: breakup.percentage ? new Decimal(breakup.percentage).toNumber() : null,
                    amount: amount.toNumber(),
                    isTaxable: isTaxable
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
            // Include overtime from both overtimeRequests and attendance records (holidays/weekends)
            const { overtimeAmount, overtimeBreakup } = await this.calculateOvertime(employee, month, year, employee.workingHoursPolicy, calculatedBasicSalary, monthStartDate, monthEndDate);

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
            // Tax is calculated based on taxable salary breakup components, not gross salary
            const { taxDeduction, taxBreakup } = await this.calculateTax(salaryBreakup, employee.rebates, packageAmount);

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
                incrementBreakup,
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

    private calculateEffectiveSalary(
        employee: any,
        monthStartDate: Date,
        monthEndDate: Date,
        totalDaysInMonth: number
    ): { effectivePackage: Decimal; incrementBreakup: any[] } {
        const baseSalary = new Decimal(employee.employeeSalary);
        const incrementBreakup: any[] = [];

        // Normalize dates to start of day for accurate comparison
        const normalizeDate = (date: Date): Date => {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            return d;
        };

        const monthStart = normalizeDate(monthStartDate);
        const monthEnd = normalizeDate(monthEndDate);

        // If no increments, return base salary
        if (!employee.increments || employee.increments.length === 0) {
            return { effectivePackage: baseSalary, incrementBreakup: [] };
        }

        // Filter increments that are effective before or during this month
        // Get the most recent increment before the month starts to know the starting salary
        const incrementsBeforeMonth = employee.increments.filter((inc: any) => {
            const incDate = normalizeDate(new Date(inc.promotionDate));
            return incDate < monthStart;
        }).sort((a: any, b: any) => 
            new Date(b.promotionDate).getTime() - new Date(a.promotionDate).getTime()
        );

        // Starting salary: If there's an increment before the month, use that salary; otherwise use base salary
        let currentSalary = incrementsBeforeMonth.length > 0 
            ? new Decimal(incrementsBeforeMonth[0].salary)
            : baseSalary;

        // Find increments that occur during this month
        const incrementsInMonth = employee.increments.filter((inc: any) => {
            const incDate = normalizeDate(new Date(inc.promotionDate));
            return incDate >= monthStart && incDate <= monthEnd;
        }).sort((a: any, b: any) => 
            new Date(a.promotionDate).getTime() - new Date(b.promotionDate).getTime()
        );

        let effectivePackage = new Decimal(0);

        if (incrementsInMonth.length === 0) {
            // No increment during this month, use current salary for entire month
            effectivePackage = currentSalary;
        } else {
            // Calculate proportional salary for each period
            let lastDate = monthStart;
            
            for (const increment of incrementsInMonth) {
                const incrementDate = normalizeDate(new Date(increment.promotionDate));
                // Calculate days from lastDate (inclusive) to incrementDate (exclusive)
                const daysBeforeIncrement = Math.max(0, Math.floor((incrementDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)));
                
                if (daysBeforeIncrement > 0) {
                    // Add salary for days before this increment
                    effectivePackage = effectivePackage.add(
                        currentSalary.mul(daysBeforeIncrement).div(totalDaysInMonth)
                    );
                }

                // Record increment/decrement info
                incrementBreakup.push({
                    id: increment.id,
                    type: increment.incrementType,
                    date: increment.promotionDate,
                    oldSalary: currentSalary.toNumber(),
                    newSalary: Number(increment.salary),
                    amount: increment.incrementAmount ? Number(increment.incrementAmount) : null,
                    percentage: increment.incrementPercentage ? Number(increment.incrementPercentage) : null,
                    method: increment.incrementMethod,
                    daysBefore: daysBeforeIncrement,
                });

                // Update current salary to new salary
                currentSalary = new Decimal(increment.salary);
                // Start counting from the day after the increment date
                lastDate = new Date(incrementDate);
                lastDate.setDate(lastDate.getDate() + 1);
            }

            // Add salary for remaining days after last increment
            const daysAfterLastIncrement = Math.max(0, Math.floor((monthEnd.getTime() - lastDate.getTime() + (1000 * 60 * 60 * 24)) / (1000 * 60 * 60 * 24)));
            if (daysAfterLastIncrement > 0) {
                effectivePackage = effectivePackage.add(
                    currentSalary.mul(daysAfterLastIncrement).div(totalDaysInMonth)
                );
            }
        }

        return { effectivePackage, incrementBreakup };
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

    private async calculateOvertime(employee: any, month: string, year: string, policy: any, basicSalary: Decimal, monthStartDate: Date, monthEndDate: Date): Promise<{ overtimeAmount: Decimal; overtimeBreakup: any[] }> {
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

        // Process overtime requests
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
                    source: 'overtime_request',
                });
            }
        }

        // Fetch ALL attendance records for the month to check for overtime on holidays/weekends
        // We need all records with checkIn/checkOut to identify holidays/off days even if overtimeHours is not set
        const attendances = await this.prisma.attendance.findMany({
            where: {
                employeeId: employee.id,
                date: {
                    gte: startDate,
                    lte: endDate,
                },
                checkIn: { not: null },
                checkOut: { not: null },
            },
            orderBy: { date: 'asc' },
        });

        // Fetch all active holidays for date checking
        const allHolidays = await this.prisma.holiday.findMany({
            where: { status: 'active' },
        });

        // Helper to check if a date is a holiday
        const isHoliday = (date: Date): boolean => {
            const month = date.getMonth() + 1;
            const day = date.getDate();
            return allHolidays.some(holiday => {
                const holidayFrom = new Date(holiday.dateFrom);
                const holidayTo = new Date(holiday.dateTo);
                const holidayMonthFrom = holidayFrom.getMonth() + 1;
                const holidayDayFrom = holidayFrom.getDate();
                const holidayMonthTo = holidayTo.getMonth() + 1;
                const holidayDayTo = holidayTo.getDate();
                
                // Check if date falls within holiday range
                if (holidayMonthFrom === holidayMonthTo) {
                    return month === holidayMonthFrom && day >= holidayDayFrom && day <= holidayDayTo;
                } else {
                    // Holiday spans across months
                    return (month === holidayMonthFrom && day >= holidayDayFrom) || 
                           (month === holidayMonthTo && day <= holidayDayTo);
                }
            });
        };

        // Helper to check if a date is a weekend
        const isWeekend = (date: Date): boolean => {
            const day = date.getDay();
            return day === 0 || day === 6; // Sunday or Saturday
        };

        // Helper to check if a date is a weekly off day based on policy
        // Weekends (Saturday/Sunday) are typically off days, but check policy overrides
        const isWeeklyOff = (date: Date): boolean => {
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const dayName = dayNames[date.getDay()];
            
            // If policy has dayOverrides, check if this day is marked as off
            if (policy && policy.dayOverrides && typeof policy.dayOverrides === 'object') {
                const overrides = policy.dayOverrides as Record<string, any>;
                const dayConfig = overrides[dayName];
                if (dayConfig && dayConfig.dayType === 'off') {
                    return true;
                }
                // If day is explicitly enabled/working, it's not an off day
                if (dayConfig && dayConfig.enabled && dayConfig.dayType !== 'off') {
                    return false;
                }
            }
            
            // Default: Weekends (Saturday=6, Sunday=0) are off days if no policy override
            const dayOfWeek = date.getDay();
            return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
        };

        // Process attendance records for overtime
        // Track dates already covered by overtime requests to avoid double counting
        const overtimeRequestDates = new Set(
            overtimes.map(ot => new Date(ot.date).toDateString())
        );

        for (const attendance of attendances) {
            const attDate = new Date(attendance.date);
            const attDateString = attDate.toDateString();
            const isHolidayDate = isHoliday(attDate);
            const isWeekendDate = isWeekend(attDate);
            const isOffDay = isWeeklyOff(attDate);
            const isOnHolidayOrOff = isHolidayDate || isOffDay;

            // Skip if already covered by overtime request (unless it's a holiday/off day - those always count)
            if (overtimeRequestDates.has(attDateString) && !isOnHolidayOrOff) {
                continue;
            }

            // Get overtimeHours from attendance record (already calculated by attendance service)
            // Convert to Decimal if it's not already
            let otHours: Decimal | null = null;
            if (attendance.overtimeHours) {
                otHours = attendance.overtimeHours instanceof Decimal 
                    ? attendance.overtimeHours 
                    : new Decimal(attendance.overtimeHours);
            }

            // For holidays/off days: use overtimeHours if available, otherwise all working hours are overtime
            if (isOnHolidayOrOff && attendance.checkIn && attendance.checkOut) {
                if (!otHours || otHours.eq(0)) {
                    // If no overtimeHours calculated, use workingHours (all hours worked are overtime on holidays/off days)
                    otHours = attendance.workingHours 
                        ? (attendance.workingHours instanceof Decimal 
                            ? attendance.workingHours 
                            : new Decimal(attendance.workingHours))
                        : new Decimal(0);
                }
                
                if (otHours && otHours.gt(0)) {
                    const overtimeAmt = hourlyRate.mul(holidayMultiplier).mul(otHours);
                    amount = amount.add(overtimeAmt);
                    overtimeBreakup.push({
                        id: `attendance-${attendance.id}`,
                        title: isHolidayDate ? 'Holiday Work' : 'Weekly Off Work',
                        date: attendance.date,
                        weekdayHours: 0,
                        holidayHours: otHours.toNumber(),
                        amount: overtimeAmt.toNumber(),
                        type: isHolidayDate ? 'holiday' : 'weekly_off',
                        source: 'attendance',
                    });
                }
            } else if (otHours && otHours.gt(0)) {
                // Regular overtime (already calculated in attendance service)
                // Only add if not already covered by overtime request
                if (!overtimeRequestDates.has(attDateString)) {
                    const overtimeAmt = hourlyRate.mul(rateMultiplier).mul(otHours);
                    
                    if (overtimeAmt.gt(0)) {
                        amount = amount.add(overtimeAmt);
                        overtimeBreakup.push({
                            id: `attendance-${attendance.id}`,
                            title: isWeekendDate ? 'Weekend Overtime' : 'Regular Overtime',
                            date: attendance.date,
                            weekdayHours: otHours.toNumber(),
                            holidayHours: 0,
                            amount: overtimeAmt.toNumber(),
                            type: isWeekendDate ? 'weekend' : 'regular',
                            source: 'attendance',
                        });
                    }
                }
            }
        }

        return { overtimeAmount: amount, overtimeBreakup };
    }

    private async calculateTax(salaryBreakup: Array<{ id: string; name: string; percentage: number | null; amount: number; isTaxable?: boolean }>, rebates: any[], packageAmount: Decimal): Promise<{ taxDeduction: Decimal; taxBreakup: any }> {
        // Calculate taxable income from salary breakup components only (not gross salary)
        // Sum up amounts from components marked as taxable
        let monthlyTaxableAmount = new Decimal(0);
        const taxableComponents: Array<{ name: string; amount: number }> = [];
        
        for (const component of salaryBreakup) {
            if (component.isTaxable && component.amount > 0) {
                monthlyTaxableAmount = monthlyTaxableAmount.add(new Decimal(component.amount));
                taxableComponents.push({
                    name: component.name,
                    amount: component.amount,
                });
            }
        }

        // Convert to annual taxable income
        const annualTaxableIncome = monthlyTaxableAmount.mul(12);

        let taxableIncome = annualTaxableIncome;
        let totalRebateAmount = new Decimal(0);
        const rebateBreakup: any[] = [];

        // Apply rebates (reduce taxable income by rebate amounts)
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

        // Ensure taxable income is not negative
        if (taxableIncome.lt(0)) {
            taxableIncome = new Decimal(0);
        }

        let taxDeduction = new Decimal(0);
        let taxSlabUsed: { minAmount: number; maxAmount: number; rate: number } | null = null;

        // Apply tax slab to taxable income
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

        // Calculate annual gross from taxable components for display (backward compatibility)
        const annualGross = annualTaxableIncome;

        const taxBreakup = {
            annualGross: annualGross.toNumber(), // Annual taxable components amount (for display)
            annualTaxableComponents: annualTaxableIncome.toNumber(),
            taxableComponents: taxableComponents, // Breakdown of taxable components
            totalRebate: totalRebateAmount.toNumber(),
            taxableIncome: taxableIncome.toNumber(), // Taxable income after rebates
            taxSlab: taxSlabUsed,
            monthlyTax: taxDeduction.toNumber(),
            rebateBreakup,
        };

        return { taxDeduction, taxBreakup };
    }
}
