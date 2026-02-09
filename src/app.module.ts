import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BrandModule } from './master/brand/brand.module';
import { GenderModule } from './master/gender/gender.module';
import { EmployeeModule } from './employee/employee.module';
import { CityModule } from './master/city/city.module';
import { DepartmentModule } from './master/department/department.module';
import { DesignationModule } from './master/designation/designation.module';
import { EmployeeGradeModule } from './master/employee-grade/employee-grade.module';
import { EmployeeStatusModule } from './master/employee-status/employee-status.module';
import { LocationModule } from './master/location/location.module';
import { EquipmentModule } from './master/equipment/equipment.module';
import { WorkingHoursPolicyModule } from './working-hours-policy/working-hours-policy.module';
import { JobTypeModule } from './master/job-type/job-type.module';
import { InstituteModule } from './master/institute/institute.module';
import { QualificationModule } from './master/qualification/qualification.module';
import { ProvidentFundModule } from './master/provident-fund/provident-fund.module';
import { TaxSlabModule } from './master/tax-slab/tax-slab.module';
import { MaritalStatusModule } from './master/marital-status/marital-status.module';
import { LeaveTypeModule } from './master/leave-type/leave-type.module';
import { LeavesPolicyModule } from './master/leaves-policy/leaves-policy.module';
import { LoanTypeModule } from './master/loan-type/loan-type.module';
import { EobiModule } from './master/eobi/eobi.module';
import { UploadModule } from './upload/upload.module';
import { BonusTypeModule } from './master/bonus-type/bonus-type.module';
import { SalaryBreakupModule } from './master/salary-breakup/salary-breakup.module';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';
import { HolidayModule } from './master/holiday/holiday.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ExitClearanceModule } from './exit-clearance/exit-clearance.module';
import { AttendanceRequestQueryModule } from './attendance-request-query/attendance-request-query.module';
import { AttendanceExemptionModule } from './attendance-exemption/attendance-exemption.module';
import { LeaveApplicationModule } from './leave-application/leave-application.module';
import { RequestForwardingModule } from './request-forwarding/request-forwarding.module';
import { AllowanceModule } from './allowance/allowance.module';
import { DeductionModule } from './deduction/deduction.module';
import { AdvanceSalaryModule } from './master/advance-salary/advance-salary.module';
import { LeaveEncashmentModule } from './leave-encashment/leave-encashment.module';
import { LoanRequestModule } from './loan-request/loan-request.module';
import { AllowanceHeadModule } from './master/allowance-head/allowance-head.module';
import { DeductionHeadModule } from './master/deduction-head/deduction-head.module';
import { OvertimeRequestModule } from './overtime-request/overtime-request.module';
import { IncrementModule } from './increment/increment.module';
import { BonusModule } from './bonus/bonus.module';
import { BankModule } from './master/bank/bank.module';
import { RebateNatureModule } from './master/rebate-nature/rebate-nature.module';
import { RebateModule } from './rebate/rebate.module';
import { PayrollModule } from './payroll/payroll.module';
import { UserPreferencesModule } from './user-preferences/user-preferences.module';
import { SocialSecurityModule } from './master/social-security/social-security.module';
import { AllocationModule } from './master/allocation/allocation.module';
import { PFModule } from './pf/pf.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { RoleModule } from './role/role.module';
import { PermissionModule } from './permission/permission.module';
import { SizeModule } from './master/size/size.module';
import { SilhouetteModule } from './master/silhouette/silhouette.module';
import { ChannelClassModule } from './master/channel-class/channel-class.module';
import { ColorModule } from './master/color/color.module';
import { UserModule } from './user/user.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ChartOfAccountModule } from './finance/chart-of-account/chart-of-account.module';
import { JournalVoucherModule } from './finance/journal-voucher/journal-voucher.module';
import { PaymentVoucherModule } from './finance/payment-voucher/payment-voucher.module';
import { ReceiptVoucherModule } from './finance/receipt-voucher/receipt-voucher.module';
import { TransferModule } from './employee/transfer/transfer.module';
import { DatabaseModule } from './database/database.module';
import { CompanyModule } from './admin/company/company.module';
import { CompanyGroupModule } from './master/company-group/company-group.module';
import { SalePoolModule } from './master/sale-pool/sale-pool.module';
import { SaleTypeModule } from './master/sale-type/sale-type.module';
import { SalesmanModule } from './master/salesman/salesman.module';
import { StorageDimensionModule } from './master/storage-dimension/storage-dimension.module';
import { MachineModule } from './master/machine/machine.module';
import { CategoryModule } from './master/ERP/category/category.module';
import { UomModule } from './master/ERP/uom/uom.module';

import { IntegrationModule } from './integration/integration.module';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => ({
        store: await redisStore({
          socket: {
            host: process.env.REDIS_HOST || '127.0.0.1',
            port: parseInt(process.env.REDIS_PORT || '6379'),
          },
        }),
      }),
    }),
    DatabaseModule,
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
    LeaveEncashmentModule, // added swagger
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
    LocationModule, // added swagger
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
    NotificationsModule,
    BankModule, // added swagger
    RebateNatureModule, // added swagger
    RebateModule, // added swagger
    PayrollModule,
    UserPreferencesModule, // added swagger
    SocialSecurityModule, // added swagger
    AllocationModule,
    PFModule,
    DashboardModule,
    RoleModule,
    PermissionModule,
    UserModule,
    NotificationsModule,
    ChartOfAccountModule,
    JournalVoucherModule,
    PaymentVoucherModule,
    ReceiptVoucherModule,
    TransferModule,
    CompanyModule,
    CompanyGroupModule,
    SalePoolModule,
    SaleTypeModule,
    SalesmanModule,
    StorageDimensionModule,
    MachineModule,
    BrandModule,
    GenderModule,
    SizeModule,
    SilhouetteModule,
    ChannelClassModule,
    ColorModule,
    CategoryModule,
    UomModule,
    IntegrationModule, // DriveSafe integration (SSO + HMAC provisioning)
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
