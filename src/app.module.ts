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

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    EmployeeModule,
    AttendanceModule,
    ExitClearanceModule,
    AttendanceRequestQueryModule,
    AttendanceExemptionModule,
    LeaveApplicationModule,
    RequestForwardingModule,
    AllowanceModule,
    DeductionModule,
    AdvanceSalaryModule,
    LoanRequestModule,
    AllowanceHeadModule,
    DeductionHeadModule,
    OvertimeRequestModule,
    IncrementModule,
    BonusModule,
    CityModule,
    DepartmentModule,
    DesignationModule,
    EmployeeGradeModule,
    EmployeeStatusModule,
    BranchModule,
    EquipmentModule,
    WorkingHoursPolicyModule,
    JobTypeModule,
    InstituteModule,
    QualificationModule,
    ProvidentFundModule,
    TaxSlabModule,
    MaritalStatusModule,
    LeaveTypeModule,
    LeavesPolicyModule,
    LoanTypeModule,
    EobiModule,
    BonusTypeModule,
    SalaryBreakupModule,
    HolidayModule,
    UploadModule,
    ActivityLogsModule,
    BankModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
