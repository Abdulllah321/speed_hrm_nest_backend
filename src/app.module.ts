import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { EmployeeModule } from './employee/employee.module';
import { CityModule } from './city/city.module';
import { DepartmentModule } from './department/department.module';
import { DesignationModule } from './designation/designation.module';
import { EmployeeGradeModule } from './employee-grade/employee-grade.module';
import { EmployeeStatusModule } from './employee-status/employee-status.module';
import { BranchModule } from './branch/branch.module';
import { EquipmentModule } from './equipment/equipment.module';
import { WorkingHoursPolicyModule } from './working-hours-policy/working-hours-policy.module';
import { JobTypeModule } from './job-type/job-type.module';
import { InstituteModule } from './institute/institute.module';
import { QualificationModule } from './qualification/qualification.module';
import { ProvidentFundModule } from './provident-fund/provident-fund.module';
import { TaxSlabModule } from './tax-slab/tax-slab.module';
import { MaritalStatusModule } from './marital-status/marital-status.module';
import { LeaveTypeModule } from './leave-type/leave-type.module';
import { LeavesPolicyModule } from './leaves-policy/leaves-policy.module';
import { LoanTypeModule } from './loan-type/loan-type.module';
import { EobiModule } from './eobi/eobi.module';
import { UploadModule } from './upload/upload.module';
import { BonusTypeModule } from './bonus-type/bonus-type.module';
import { SalaryBreakupModule } from './salary-breakup/salary-breakup.module';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';
import { HolidayModule } from './holiday/holiday.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ExitClearanceModule } from './exit-clearance/exit-clearance.module';
import { AttendanceRequestQueryModule } from './attendance-request-query/attendance-request-query.module';
import { AttendanceExemptionModule } from './attendance-exemption/attendance-exemption.module';
import { LeaveApplicationModule } from './leave-application/leave-application.module';
import { RequestForwardingModule } from './request-forwarding/request-forwarding.module';
import { AllowanceModule } from './allowance/allowance.module';
import { DeductionModule } from './deduction/deduction.module';
import { AdvanceSalaryModule } from './advance-salary/advance-salary.module';
import { LoanRequestModule } from './loan-request/loan-request.module';
import { AllowanceHeadModule } from './allowance-head/allowance-head.module';
import { DeductionHeadModule } from './deduction-head/deduction-head.module';
import { OvertimeRequestModule } from './overtime-request/overtime-request.module';
import { IncrementModule } from './increment/increment.module';
import { BonusModule } from './bonus/bonus.module';
import { BankModule } from './bank/bank.module';
import { RebateNatureModule } from './rebate-nature/rebate-nature.module';
import { PayrollModule } from './payroll/payroll.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule, // added swagger
    EmployeeModule, // added swagger
    AttendanceModule, // added swagger
    ExitClearanceModule, // added swagger
    AttendanceRequestQueryModule, // added swagger
    AttendanceExemptionModule, // added swagger
    LeaveApplicationModule, // added swagger
    RequestForwardingModule, // added swagger
    AllowanceModule, // added swagger
    DeductionModule, // added swagger
    AdvanceSalaryModule, // added swagger
    LoanRequestModule, // added swagger
    AllowanceHeadModule, // added swagger
    DeductionHeadModule, // added swagger
    OvertimeRequestModule, // added swagger
    IncrementModule, // added swagger
    BonusModule, // added swagger
    CityModule, // added swagger
    DepartmentModule, // added swagger
    DesignationModule, // added swagger
    EmployeeGradeModule, // added swagger
    EmployeeStatusModule, // added swagger
    BranchModule, // added swagger
    EquipmentModule, // added swagger
    WorkingHoursPolicyModule, // added swagger
    JobTypeModule, // added swagger
    InstituteModule, // added swagger
    QualificationModule, // added swagger
    ProvidentFundModule, // added swagger
    TaxSlabModule, // added swagger
    MaritalStatusModule, // added swagger
    LeaveTypeModule, // added swagger
    LeavesPolicyModule, // added swagger
    LoanTypeModule, // added swagger
    EobiModule, // added swagger
    BonusTypeModule, // added swagger
    SalaryBreakupModule, // added swagger
    HolidayModule, // added swagger
    UploadModule, // added swagger
    ActivityLogsModule,
    BankModule, // added swagger
    RebateNatureModule, // added swagger
    PayrollModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
