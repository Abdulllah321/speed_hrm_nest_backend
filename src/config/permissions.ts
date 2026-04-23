import { hrtime } from 'process';

export const PERMISSIONS = [
  // ---- Master Module ----
  // Department
  {
    name: 'master.department.create',
    module: 'master.department',
    action: 'create',
    description: 'Create Department',
  },
  {
    name: 'master.department.read',
    module: 'master.department',
    action: 'read',
    description: 'Read Department',
  },
  {
    name: 'master.department.update',
    module: 'master.department',
    action: 'update',
    description: 'Update Department',
  },
  {
    name: 'master.department.delete',
    module: 'master.department',
    action: 'delete',
    description: 'Delete Department',
  },
  //SubDepartment
  {
    name: 'master.sub-department.create',
    module: 'master.sub-department',
    action: 'create',
    description: 'Create SubDepartment',
  },
  {
    name: 'master.sub-department.read',
    module: 'master.sub-department',
    action: 'read',
    description: 'Read SubDepartment',
  },
  {
    name: 'master.sub-department.update',
    module: 'master.sub-department',
    action: 'update',
    description: 'Update SubDepartment',
  },
  {
    name: 'master.sub-department.delete',
    module: 'master.sub-department',
    action: 'delete',
    description: 'Delete SubDepartment',
  },
  //Institute
  {
    name: 'master.institute.create',
    module: 'master.institute',
    action: 'create',
    description: 'Create Institute',
  },
  {
    name: 'master.institute.read',
    module: 'master.institute',
    action: 'read',
    description: 'Read Institute',
  },
  {
    name: 'master.institute.update',

    description: 'Update Institute',
  },
  {
    name: 'master.institute.delete',
    module: 'master.institute',
    action: 'delete',
    description: 'Delete Institute',
  },
  // Qualification
  {
    name: 'master.qualification.create',
    module: 'master.qualification',
    action: 'create',
    description: 'Create Qualification',
  },
  {
    name: 'master.qualification.read',
    module: 'master.qualification',
    action: 'read',
    description: 'Read Qualification',
  },
  {
    name: 'master.qualification.update',
    module: 'master.qualification',
    action: 'update',
    description: 'Update Qualification',
  },
  {
    name: 'master.qualification.delete',
    module: 'master.qualification',
    action: 'delete',
    description: 'Delete Qualification',
  },
  // Designation
  {
    name: 'master.designation.create',
    module: 'master.designation',
    action: 'create',
    description: 'Create Designation',
  },
  {
    name: 'master.designation.read',
    module: 'master.designation',
    action: 'read',
    description: 'Read Designation',
  },
  {
    name: 'master.designation.update',
    module: 'master.designation',
    action: 'update',
    description: 'Update Designation',
  },
  {
    name: 'master.designation.delete',
    module: 'master.designation',
    action: 'delete',
    description: 'Delete Designation',
  },
  // Location
  {
    name: 'master.location.create',
    module: 'master.location',
    action: 'create',
    description: 'Create Location',
  },
  {
    name: 'master.location.read',
    module: 'master.location',
    action: 'read',
    description: 'Read Location',
  },
  {
    name: 'master.location.update',
    module: 'master.location',
    action: 'update',
    description: 'Update Location',
  },
  {
    name: 'master.location.delete',
    module: 'master.location',
    action: 'delete',
    description: 'Delete Location',
  },
  // POS
  {
    name: 'master.pos.create',
    module: 'master.pos',
    action: 'create',
    description: 'Create POS',
  },
  {
    name: 'master.pos.read',
    module: 'master.pos',
    action: 'read',
    description: 'Read POS',
  },
  {
    name: 'master.pos.update',
    module: 'master.pos',
    action: 'update',
    description: 'Update POS',
  },
  {
    name: 'master.pos.delete',
    module: 'master.pos',
    action: 'delete',
    description: 'Delete POS',
  },
  // Job Type
  {
    name: 'master.job-type.create',
    module: 'master.job-type',
    action: 'create',
    description: 'Create Job Type',
  },
  {
    name: 'master.job-type.read',
    module: 'master.job-type',
    action: 'read',
    description: 'Read Job Type',
  },
  {
    name: 'master.job-type.update',
    module: 'master.job-type',
    action: 'update',
    description: 'Update Job Type',
  },
  {
    name: 'master.job-type.delete',
    module: 'master.job-type',
    action: 'delete',
    description: 'Delete Job Type',
  },
  // Marital Status
  {
    name: 'master.marital-status.create',
    module: 'master.marital-status',
    action: 'create',
    description: 'Create Marital Status',
  },
  {
    name: 'master.marital-status.read',
    module: 'master.marital-status',
    action: 'read',
    description: 'Read Marital Status',
  },
  {
    name: 'master.marital-status.update',
    module: 'master.marital-status',
    action: 'update',
    description: 'Update Marital Status',
  },
  {
    name: 'master.marital-status.delete',
    module: 'master.marital-status',
    action: 'delete',
    description: 'Delete Marital Status',
  },
  // Employee Grade
  {
    name: 'master.employee-grade.create',
    module: 'master.employee-grade',
    action: 'create',
    description: 'Create Employee Grade',
  },
  {
    name: 'master.employee-grade.read',
    module: 'master.employee-grade',
    action: 'read',
    description: 'Read Employee Grade',
  },
  {
    name: 'master.employee-grade.update',
    module: 'master.employee-grade',
    action: 'update',
    description: 'Update Employee Grade',
  },
  {
    name: 'master.employee-grade.delete',
    module: 'master.employee-grade',
    action: 'delete',
    description: 'Delete Employee Grade',
  },
  // Employment Status
  {
    name: 'master.employee-status.create',
    module: 'master.employee-status',
    action: 'create',
    description: 'Create Employment Status',
  },
  {
    name: 'master.employee-status.read',
    module: 'master.employee-status',
    action: 'read',
    description: 'Read Employment Status',
  },
  {
    name: 'master.employee-status.update',
    module: 'master.employee-status',
    action: 'update',
    description: 'Update Employment Status',
  },
  {
    name: 'master.employee-status.delete',
    module: 'master.employee-status',
    action: 'delete',
    description: 'Delete Employment Status',
  },
  // City
  {
    name: 'master.city.create',
    module: 'master.city',
    action: 'create',
    description: 'Create City',
  },
  {
    name: 'master.city.read',
    module: 'master.city',
    action: 'read',
    description: 'Read City',
  },
  {
    name: 'master.city.update',
    module: 'master.city',
    action: 'update',
    description: 'Update City',
  },
  {
    name: 'master.city.delete',
    module: 'master.city',
    action: 'delete',
    description: 'Delete City',
  },
  // Allocation
  {
    name: 'master.allocation.create',
    module: 'master.allocation',
    action: 'create',
    description: 'Create Allocation',
  },
  {
    name: 'master.allocation.read',
    module: 'master.allocation',
    action: 'read',
    description: 'Read Allocation',
  },
  {
    name: 'master.allocation.update',
    module: 'master.allocation',
    action: 'update',
    description: 'Update Allocation',
  },
  {
    name: 'master.allocation.delete',
    module: 'master.allocation',
    action: 'delete',
    description: 'Delete Allocation',
  },
  // Loan Types
  {
    name: 'master.loan-type.create',
    module: 'master.loan-type',
    action: 'create',
    description: 'Create Loan Type',
  },
  {
    name: 'master.loan-type.read',
    module: 'master.loan-type',
    action: 'read',
    description: 'Read Loan Type',
  },
  {
    name: 'master.loan-type.update',
    module: 'master.loan-type',
    action: 'update',
    description: 'Update Loan Type',
  },
  {
    name: 'master.loan-type.delete',

    description: 'Delete Loan Type',
  },
  // Leave Types
  {
    name: 'master.leave-type.create',

    description: 'Create Leave Type',
  },
  {
    name: 'master.leave-type.read',

    description: 'Read Leave Type',
  },
  {
    name: 'master.leave-type.update',

    description: 'Update Leave Type',
  },
  {
    name: 'master.leave-type.delete',

    description: 'Delete Leave Type',
  },
  // Leaves Policy
  {
    name: 'master.leaves-policy.create',

    description: 'Create Leaves Policy',
  },
  {
    name: 'master.leaves-policy.read',

    description: 'Read Leaves Policy',
  },
  {
    name: 'master.leaves-policy.update',

    description: 'Update Leaves Policy',
  },
  {
    name: 'master.leaves-policy.delete',
    description: 'Delete Leaves Policy',
  },
  // Equipment
  {
    name: 'master.equipment.create',

    description: 'Create Equipment',
  },
  {
    name: 'master.equipment.read',

    description: 'Read Equipment',
  },
  {
    name: 'master.equipment.update',

    description: 'Update Equipment',
  },
  {
    name: 'master.equipment.delete',
    description: 'Delete Equipment',
  },
  // Salary Breakup
  {
    name: 'master.salary-breakup.create',

    description: 'Create Salary Breakup',
  },
  {
    name: 'master.salary-breakup.read',

    description: 'Read Salary Breakup',
  },
  {
    name: 'master.salary-breakup.update',

    description: 'Update Salary Breakup',
  },
  {
    name: 'master.salary-breakup.delete',

    description: 'Delete Salary Breakup',
  },
  // EOBI
  {
    name: 'master.eobi.create',

    description: 'Create EOBI',
  },
  {
    name: 'master.eobi.read',

    description: 'Read EOBI',
  },
  {
    name: 'master.eobi.update',

    description: 'Update EOBI',
  },
  {
    name: 'master.eobi.delete',

    description: 'Delete EOBI',
  },
  // Social Security
  {
    name: 'master.social-security.create',

    description: 'Create Social Security',
  },
  {
    name: 'master.social-security.read',

    description: 'Read Social Security',
  },
  {
    name: 'master.social-security.update',

    description: 'Update Social Security',
  },
  {
    name: 'master.social-security.delete',

    description: 'Delete Social Security',
  },
  // Tax Slabs
  {
    name: 'master.tax-slab.create',

    description: 'Create Tax Slab',
  },
  {
    name: 'master.tax-slab.read',

    description: 'Read Tax Slab',
  },
  {
    name: 'master.tax-slab.update',
    description: 'Update Tax Slab',
  },
  {
    name: 'master.tax-slab.delete',

    description: 'Delete Tax Slab',
  },
  // Provident Fund
  {
    name: 'master.provident-fund.create',

    description: 'Create Provident Fund',
  },
  {
    name: 'master.provident-fund.read',

    description: 'Read Provident Fund',
  },
  {
    name: 'master.provident-fund.update',

    description: 'Update Provident Fund',
  },
  {
    name: 'master.provident-fund.delete',

    description: 'Delete Provident Fund',
  },
  // Bonus Types
  {
    name: 'master.bonus-type.create',

    description: 'Create Bonus Type',
  },
  {
    name: 'master.bonus-type.read',

    description: 'Read Bonus Type',
  },
  {
    name: 'master.bonus-type.update',

    description: 'Update Bonus Type',
  },
  {
    name: 'master.bonus-type.delete',

    description: 'Delete Bonus Type',
  },
  // Allowance Head
  {
    name: 'master.allowance-head.create',

    description: 'Create Allowance Head',
  },
  {
    name: 'master.allowance-head.read',

    description: 'Read Allowance Head',
  },
  {
    name: 'master.allowance-head.update',

    description: 'Update Allowance Head',
  },
  {
    name: 'master.allowance-head.delete',

    description: 'Delete Allowance Head',
  },
  // Deduction Head
  {
    name: 'master.deduction-head.create',

    description: 'Create Deduction Head',
  },
  {
    name: 'master.deduction-head.read',

    description: 'Read Deduction Head',
  },
  {
    name: 'master.deduction-head.update',

    description: 'Update Deduction Head',
  },
  {
    name: 'master.deduction-head.delete',

    description: 'Delete Deduction Head',
  },
  // Bank
  {
    name: 'master.bank.create',
    description: 'Create Bank',
  },
  {
    name: 'master.bank.read',
    description: 'Read Bank',
  },
  {
    name: 'master.bank.update',
    description: 'Update Bank',
  },
  {
    name: 'master.bank.delete',
    description: 'Delete Bank',
  },

  // HR MODULES
  //Dashboard
  {
    name: 'hr.dashboard.view',
    description: 'View HR Dashboard',
  },
  //Employee
  {
    name: 'hr.employee.create',
    description: 'Create Employee',
  },
  {
    name: 'hr.employee.read',
    description: 'Read Employee',
  },
  {
    name: 'hr.employee.transfer',
    description: 'Transfer Employee',
  },
  {
    name: 'hr.employee.user-account',
    description: 'User Account',
  },

  {
    name: 'hr.employee.update',
    description: 'Update Employee',
  },
  {
    name: 'hr.employee.delete',
    description: 'Delete Employee',
  },
  //Exit Clearance
  {
    name: 'hr.exit-clearance.create',
    description: 'Exit Clearance',
  },
  {
    name: 'hr.exit-clearance.read',
    description: 'Read Exit Clearance',
  },
  {
    name: 'hr.exit-clearance.update',
    description: 'Update Exit Clearance',
  },
  {
    name: 'hr.exit-clearance.delete',
    description: 'Delete Exit Clearance',
  },
  //Attendance
  {
    name: 'hr.attendance.view',
    description: 'View Attendance',
  },
  {
    name: 'hr.attendance.create',
    description: 'Create Attendance',
  },
  {
    name: 'hr.attendance.update',
    description: 'Update Attendance',
  },
  {
    name: 'hr.attendance.delete',
    description: 'Delete Attendance',
  },
  {
    name: 'hr.attendance.summary',
    description: 'Attendance Summary',
  },
  {
    name: 'hr.attendance.request',
    description: 'Attendance Request',
  },
  {
    name: 'hr.attendance.request-list',
    description: 'Attendance Request List',
  },
  {
    name: 'hr.attendance.request-update',
    description: 'Update Attendance Request',
  },
  {
    name: 'hr.attendance.request-delete',
    description: 'Delete Attendance Request',
  },
  {
    name: 'hr.attendance.request-approve',
    description: 'Approve Attendance Request',
  },
  // Overtime Request
  {
    name: 'hr.overtime-request.read',
    description: 'Read Overtime Request',
  },
  {
    name: 'hr.overtime-request.create',
    description: 'Create Overtime Request',
  },
  {
    name: 'hr.overtime-request.update',
    description: 'Update Overtime Request',
  },
  {
    name: 'hr.overtime-request.delete',
    description: 'Delete Overtime Request',
  },
  {
    name: 'hr.overtime-request.approve',
    description: 'Approve Overtime Request',
  },
  {
    name: 'hr.attendance.exemptions',
    description: 'Attendance Exemptions',
  },
  {
    name: 'hr.attendance.exemptions-list',
    description: 'Attendance Exemptions List',
  },

  // working hour Policy
  {
    name: 'hr.working-hour-policy.create',
    description: 'Create Working Hour Policy',
  },
  {
    name: 'hr.working-hour-policy.read',
    description: 'Read Working Hour Policy',
  },
  {
    name: 'hr.working-hour-policy.update',
    description: 'Update Working Hour Policy',
  },
  {
    name: 'hr.working-hour-policy.delete',
    description: 'Delete Working Hour Policy',
  },
  {
    name: 'hr.working-hour-policy.assign',
    description: 'Assign Working Hour Policy',
  },
  {
    name: 'hr.working-hour-policy.assign-list',
    description: 'Assign Working Hour Policy List',
  },
  // Holiday
  {
    name: 'hr.holiday.create',
    description: 'Create Holiday',
  },
  {
    name: 'hr.holiday.read',
    description: 'Read Holiday',
  },
  {
    name: 'hr.holiday.update',
    description: 'Update Holiday',
  },
  {
    name: 'hr.holiday.delete',
    description: 'Delete Holiday',
  },
  //Leave
  {
    name: 'hr.leave.create',
    description: 'Create Leave',
  },
  {
    name: 'hr.leave.read',
    description: 'Read Leave',
  },
  {
    name: 'hr.leave.update',
    description: 'Update Leave',
  },
  {
    name: 'hr.leave.delete',
    description: 'Delete Leave',
  },
  {
    name: 'hr.leave.selectEmployee',
    description: 'Select Employee for Leave',
  },
  // Loan Request
  {
    name: 'hr.loan-request.read',
    description: 'Read Loan Request',
  },
  {
    name: 'hr.loan-request.create',
    description: 'Create Loan Request',
  },
  {
    name: 'hr.loan-request.update',
    description: 'Update Loan Request',
  },
  {
    name: 'hr.loan-request.delete',
    description: 'Delete Loan Request',
  },
  {
    name: 'hr.loan-request.approve',
    description: 'Approve Loan Request',
  },
  // Leave Encashment
  {
    name: 'hr.leave-encashment.read',
    description: 'Read Leave Encashment',
  },
  {
    name: 'hr.leave-encashment.create',
    description: 'Create Leave Encashment',
  },
  {
    name: 'hr.leave-encashment.update',
    description: 'Update Leave Encashment',
  },
  {
    name: 'hr.leave-encashment.delete',
    description: 'Delete Leave Encashment',
  },
  {
    name: 'hr.leave-encashment.approve',
    description: 'Approve Leave Encashment',
  },

  // Advance Salary
  {
    name: 'hr.advance-salary.read',
    description: 'Read Advance Salary',
  },
  {
    name: 'hr.advance-salary.create',
    description: 'Create Advance Salary',
  },
  {
    name: 'hr.advance-salary.update',
    description: 'Update Advance Salary',
  },
  {
    name: 'hr.advance-salary.delete',
    description: 'Delete Advance Salary',
  },
  {
    name: 'hr.advance-salary.approve',
    description: 'Approve Advance Salary',
  },
  // Request Forwarding
  {
    name: 'hr.request-forwarding.view',
    description: 'View Request Forwarding',
  },
  {
    name: 'hr.request-forwarding.manage',
    description: 'Manage Request Forwarding',
  },
  {
    name: 'hr.request-forwarding.attendance',
    description: 'Request Forwarding Attendance',
  },
  {
    name: 'hr.request-forwarding.advance-salary',
    description: 'Request Forwarding Advance Salary',
  },
  {
    name: 'hr.request-forwarding.loan',
    description: 'Request Forwarding Loan',
  },
  {
    name: 'hr.request-forwarding.leave-application',
    description: 'Request Forwarding Leave Application',
  },
  {
    name: 'hr.request-forwarding.leave-encashment',
    description: 'Request Forwarding Leave Encashment',
  },
  // Payroll
  {
    name: 'hr.payroll.read',
    description: 'Read Payroll',
  },
  {
    name: 'hr.payroll.create',
    description: 'Create Payroll',
  },
  {
    name: 'hr.payroll.update',
    description: 'Update Payroll',
  },
  {
    name: 'hr.payroll.delete',
    description: 'Delete Payroll',
  },
  // Increment
  {
    name: 'hr.increment.read',
    description: 'Read Increment',
  },
  {
    name: 'hr.increment.create',
    description: 'Create Increment',
  },
  {
    name: 'hr.increment.update',
    description: 'Update Increment',
  },
  {
    name: 'hr.increment.delete',
    description: 'Delete Increment',
  },
  {
    name: 'hr.increment.approve',
    description: 'Approve Increment',
  },
  // Bonus
  {
    name: 'hr.bonus.read',
    description: 'Read Bonus',
  },
  {
    name: 'hr.bonus.create',
    description: 'Create Bonus',
  },
  {
    name: 'hr.bonus.update',
    description: 'Update Bonus',
  },
  {
    name: 'hr.bonus.delete',
    description: 'Delete Bonus',
  },
  {
    name: 'hr.bonus.approve',
    description: 'Approve Bonus',
  },
  // Salary Sheet
  {
    name: 'hr.salary-sheet.read',
    description: 'Read Salary Sheet',
  },
  {
    name: 'hr.salary-sheet.create',
    description: 'Create Salary Sheet',
  },
  {
    name: 'hr.salary-sheet.update',
    description: 'Update Salary Sheet',
  },
  {
    name: 'hr.salary-sheet.delete',
    description: 'Delete Salary Sheet',
  },
  // Allowance
  {
    name: 'hr.allowance.read',
    description: 'Read Allowance',
  },
  {
    name: 'hr.allowance.create',
    description: 'Create Allowance',
  },
  {
    name: 'hr.allowance.update',
    description: 'Update Allowance',
  },
  {
    name: 'hr.allowance.delete',
    description: 'Delete Allowance',
  },
  {
    name: 'hr.allowance.approve',
    description: 'Approve Allowance',
  },
  // Deduction
  {
    name: 'hr.deduction.read',
    description: 'Read Deduction',
  },
  {
    name: 'hr.deduction.create',
    description: 'Create Deduction',
  },
  {
    name: 'hr.deduction.update',
    description: 'Update Deduction',
  },
  {
    name: 'hr.deduction.delete',
    description: 'Delete Deduction',
  },
  {
    name: 'hr.deduction.approve',
    description: 'Approve Deduction',
  },
  // Provident Fund (Employee Operations)
  {
    name: 'hr.provident-fund.read',
    description: 'Read Employee Provident Fund',
  },
  {
    name: 'hr.provident-fund.create',
    description: 'Create Employee Provident Fund',
  },
  {
    name: 'hr.provident-fund.update',
    description: 'Update Employee Provident Fund',
  },
  {
    name: 'hr.provident-fund.delete',
    description: 'Delete Employee Provident Fund',
  },
  // Role Management
  {
    name: 'role.create',
    module: 'role',
    action: 'create',
    description: 'Create Role',
  },
  {
    name: 'role.read',
    module: 'role',
    action: 'read',
    description: 'Read Role',
  },
  {
    name: 'role.update',
    module: 'role',
    action: 'update',
    description: 'Update Role',
  },
  {
    name: 'role.delete',
    module: 'role',
    action: 'delete',
    description: 'Delete Role',
  },

  // Rebate
  {
    name: 'hr.rebate.read',
    description: 'Read Rebate',
  },
  {
    name: 'hr.rebate.create',
    description: 'Create Rebate',
  },
  {
    name: 'hr.rebate.update',
    description: 'Update Rebate',
  },
  {
    name: 'hr.rebate.delete',
    description: 'Delete Rebate',
  },
  // Rebate Nature
  {
    name: 'hr.rebate-nature.read',
    description: 'Read Rebate Nature',
  },
  {
    name: 'hr.rebate-nature.create',
    description: 'Create Rebate Nature',
  },
  {
    name: 'hr.rebate-nature.update',
    description: 'Update Rebate Nature',
  },
  {
    name: 'hr.rebate-nature.delete',
    description: 'Delete Rebate Nature',
  },
  // Social Security (Employee Operations)
  {
    name: 'hr.social-security.read',
    description: 'Read Employee Social Security',
  },
  {
    name: 'hr.social-security.create',
    description: 'Create Employee Social Security',
  },
  {
    name: 'hr.social-security.update',
    description: 'Update Employee Social Security',
  },
  {
    name: 'hr.social-security.delete',
    description: 'Delete Employee Social Security',
  },
  // ---- ERP Finance & Accounts Module ----
  // Chart of Account
  {
    name: 'erp.finance.chart-of-account.create',
    module: 'erp.finance.chart-of-account',
    action: 'create',
    description: 'Create Chart of Account',
  },
  {
    name: 'erp.finance.chart-of-account.read',
    module: 'erp.finance.chart-of-account',
    action: 'read',
    description: 'Read Chart of Account',
  },
  {
    name: 'erp.finance.chart-of-account.update',
    module: 'erp.finance.chart-of-account',
    action: 'update',
    description: 'Update Chart of Account',
  },
  {
    name: 'erp.finance.chart-of-account.delete',
    module: 'erp.finance.chart-of-account',
    action: 'delete',
    description: 'Delete Chart of Account',
  },

  // Journal Voucher
  {
    name: 'erp.finance.journal-voucher.create',
    module: 'erp.finance.journal-voucher',
    action: 'create',
    description: 'Create Journal Voucher',
  },
  {
    name: 'erp.finance.journal-voucher.read',
    module: 'erp.finance.journal-voucher',
    action: 'read',
    description: 'Read Journal Voucher',
  },
  {
    name: 'erp.finance.journal-voucher.update',
    module: 'erp.finance.journal-voucher',
    action: 'update',
    description: 'Update Journal Voucher',
  },
  {
    name: 'erp.finance.journal-voucher.delete',
    module: 'erp.finance.journal-voucher',
    action: 'delete',
    description: 'Delete Journal Voucher',
  },
  {
    name: 'erp.finance.journal-voucher.approve',
    module: 'erp.finance.journal-voucher',
    action: 'approve',
    description: 'Approve Journal Voucher',
  },

  // Payment Voucher
  {
    name: 'erp.finance.payment-voucher.create',
    module: 'erp.finance.payment-voucher',
    action: 'create',
    description: 'Create Payment Voucher',
  },
  {
    name: 'erp.finance.payment-voucher.read',
    module: 'erp.finance.payment-voucher',
    action: 'read',
    description: 'Read Payment Voucher',
  },
  {
    name: 'erp.finance.payment-voucher.update',
    module: 'erp.finance.payment-voucher',
    action: 'update',
    description: 'Update Payment Voucher',
  },
  {
    name: 'erp.finance.payment-voucher.delete',
    module: 'erp.finance.payment-voucher',
    action: 'delete',
    description: 'Delete Payment Voucher',
  },
  {
    name: 'erp.finance.payment-voucher.approve',
    module: 'erp.finance.payment-voucher',
    action: 'approve',
    description: 'Approve Payment Voucher',
  },

  // Finance Account Configuration
  {
    name: 'erp.finance.account-config.read',
    module: 'erp.finance.account-config',
    action: 'read',
    description: 'Read Finance Account Configuration',
  },
  {
    name: 'erp.finance.account-config.update',
    module: 'erp.finance.account-config',
    action: 'update',
    description: 'Update Finance Account Configuration',
  },

  // Receipt Voucher
  {
    name: 'erp.finance.receipt-voucher.create',
    module: 'erp.finance.receipt-voucher',
    action: 'create',
    description: 'Create Receipt Voucher',
  },
  {
    name: 'erp.finance.receipt-voucher.read',
    module: 'erp.finance.receipt-voucher',
    action: 'read',
    description: 'Read Receipt Voucher',
  },
  {
    name: 'erp.finance.receipt-voucher.update',
    module: 'erp.finance.receipt-voucher',
    action: 'update',
    description: 'Update Receipt Voucher',
  },
  {
    name: 'erp.finance.receipt-voucher.delete',
    module: 'erp.finance.receipt-voucher',
    action: 'delete',
    description: 'Delete Receipt Voucher',
  },
  {
    name: 'erp.finance.receipt-voucher.approve',
    module: 'erp.finance.receipt-voucher',
    action: 'approve',
    description: 'Approve Receipt Voucher',
  },

  // Brand
  {
    name: 'master.brand.create',
    module: 'master.brand',
    action: 'create',
    description: 'Create Brand',
  },
  {
    name: 'master.brand.read',
    module: 'master.brand',
    action: 'read',
    description: 'Read Brand',
  },
  {
    name: 'master.brand.update',
    module: 'master.brand',
    action: 'update',
    description: 'Update Brand',
  },
  {
    name: 'master.brand.delete',
    module: 'master.brand',
    action: 'delete',
    description: 'Delete Brand',
  },

  // Division
  {
    name: 'master.division.create',
    module: 'master.division',
    action: 'create',
    description: 'Create Division',
  },
  {
    name: 'master.division.read',
    module: 'master.division',
    action: 'read',
    description: 'Read Division',
  },
  {
    name: 'master.division.update',
    module: 'master.division',
    action: 'update',
    description: 'Update Division',
  },
  {
    name: 'master.division.delete',
    module: 'master.division',
    action: 'delete',
    description: 'Delete Division',
  },

  // Channel Class
  {
    name: 'master.channel-class.create',
    module: 'master.channel-class',
    action: 'create',
    description: 'Create Channel Class',
  },
  {
    name: 'master.channel-class.read',
    module: 'master.channel-class',
    action: 'read',
    description: 'Read Channel Class',
  },
  {
    name: 'master.channel-class.update',
    module: 'master.channel-class',
    action: 'update',
    description: 'Update Channel Class',
  },
  {
    name: 'master.channel-class.delete',
    module: 'master.channel-class',
    action: 'delete',
    description: 'Delete Channel Class',
  },

  // Color
  {
    name: 'master.color.create',
    module: 'master.color',
    action: 'create',
    description: 'Create Color',
  },
  {
    name: 'master.color.read',
    module: 'master.color',
    action: 'read',
    description: 'Read Color',
  },
  {
    name: 'master.color.update',
    module: 'master.color',
    action: 'update',
    description: 'Update Color',
  },
  {
    name: 'master.color.delete',
    module: 'master.color',
    action: 'delete',
    description: 'Delete Color',
  },

  // Gender
  {
    name: 'master.gender.create',
    module: 'master.gender',
    action: 'create',
    description: 'Create Gender',
  },
  {
    name: 'master.gender.read',
    module: 'master.gender',
    action: 'read',
    description: 'Read Gender',
  },
  {
    name: 'master.gender.update',
    module: 'master.gender',
    action: 'update',
    description: 'Update Gender',
  },
  {
    name: 'master.gender.delete',
    module: 'master.gender',
    action: 'delete',
    description: 'Delete Gender',
  },

  // Size
  {
    name: 'master.size.create',
    module: 'master.size',
    action: 'create',
    description: 'Create Size',
  },
  {
    name: 'master.size.read',
    module: 'master.size',
    action: 'read',
    description: 'Read Size',
  },
  {
    name: 'master.size.update',
    module: 'master.size',
    action: 'update',
    description: 'Update Size',
  },
  {
    name: 'master.size.delete',
    module: 'master.size',
    action: 'delete',
    description: 'Delete Size',
  },

  // Silhouette
  {
    name: 'master.silhouette.create',
    module: 'master.silhouette',
    action: 'create',
    description: 'Create Silhouette',
  },
  {
    name: 'master.silhouette.read',
    module: 'master.silhouette',
    action: 'read',
    description: 'Read Silhouette',
  },
  {
    name: 'master.silhouette.update',
    module: 'master.silhouette',
    action: 'update',
    description: 'Update Silhouette',
  },
  {
    name: 'master.silhouette.delete',
    module: 'master.silhouette',
    action: 'delete',
    description: 'Delete Silhouette',
  },

  // Tax Rate
  {
    name: 'master.tax-rate.create',
    module: 'master.tax-rate',
    action: 'create',
    description: 'Create Tax Rate',
  },
  {
    name: 'master.tax-rate.read',
    module: 'master.tax-rate',
    action: 'read',
    description: 'Read Tax Rate',
  },
  {
    name: 'master.tax-rate.update',
    module: 'master.tax-rate',
    action: 'update',
    description: 'Update Tax Rate',
  },
  {
    name: 'master.tax-rate.delete',
    module: 'master.tax-rate',
    action: 'delete',
    description: 'Delete Tax Rate',
  },

  // Item Class
  {
    name: 'master.item-class.create',
    module: 'master.item-class',
    action: 'create',
    description: 'Create Item Class',
  },
  {
    name: 'master.item-class.read',
    module: 'master.item-class',
    action: 'read',
    description: 'Read Item Class',
  },
  {
    name: 'master.item-class.update',
    module: 'master.item-class',
    action: 'update',
    description: 'Update Item Class',
  },
  {
    name: 'master.item-class.delete',
    module: 'master.item-class',
    action: 'delete',
    description: 'Delete Item Class',
  },

  // Item Subclass
  {
    name: 'master.item-subclass.create',
    module: 'master.item-subclass',
    action: 'create',
    description: 'Create Item Subclass',
  },
  {
    name: 'master.item-subclass.read',
    module: 'master.item-subclass',
    action: 'read',
    description: 'Read Item Subclass',
  },
  {
    name: 'master.item-subclass.update',
    module: 'master.item-subclass',
    action: 'update',
    description: 'Update Item Subclass',
  },
  {
    name: 'master.item-subclass.delete',
    module: 'master.item-subclass',
    action: 'delete',
    description: 'Delete Item Subclass',
  },

  // Old Season
  {
    name: 'master.old-season.create',
    module: 'master.old-season',
    action: 'create',
    description: 'Create Old Season',
  },
  {
    name: 'master.old-season.read',
    module: 'master.old-season',
    action: 'read',
    description: 'Read Old Season',
  },
  {
    name: 'master.old-season.update',
    module: 'master.old-season',
    action: 'update',
    description: 'Update Old Season',
  },
  {
    name: 'master.old-season.delete',
    module: 'master.old-season',
    action: 'delete',
    description: 'Delete Old Season',
  },

  // Season
  {
    name: 'master.season.create',
    module: 'master.season',
    action: 'create',
    description: 'Create Season',
  },
  {
    name: 'master.season.read',
    module: 'master.season',
    action: 'read',
    description: 'Read Season',
  },
  {
    name: 'master.season.update',
    module: 'master.season',
    action: 'update',
    description: 'Update Season',
  },
  {
    name: 'master.season.delete',
    module: 'master.season',
    action: 'delete',
    description: 'Delete Season',
  },

  // Segment
  {
    name: 'master.segment.create',
    module: 'master.segment',
    action: 'create',
    description: 'Create Segment',
  },
  {
    name: 'master.segment.read',
    module: 'master.segment',
    action: 'read',
    description: 'Read Segment',
  },
  {
    name: 'master.segment.update',
    module: 'master.segment',
    action: 'update',
    description: 'Update Segment',
  },
  {
    name: 'master.segment.delete',
    module: 'master.segment',
    action: 'delete',
    description: 'Delete Segment',
  },

  // HS Code
  {
    name: 'master.hs-code.create',
    module: 'master.hs-code',
    action: 'create',
    description: 'Create HS Code',
  },
  {
    name: 'master.hs-code.read',
    module: 'master.hs-code',
    action: 'read',
    description: 'Read HS Code',
  },
  {
    name: 'master.hs-code.update',
    module: 'master.hs-code',
    action: 'update',
    description: 'Update HS Code',
  },
  {
    name: 'master.hs-code.delete',
    module: 'master.hs-code',
    action: 'delete',
    description: 'Delete HS Code',
  },
  // ERP Category
  {
    name: 'master.category.create',
    module: 'master.category',
    action: 'create',
    description: 'Create Category',
  },
  {
    name: 'master.category.read',
    module: 'master.category',
    action: 'read',
    description: 'Read Category',
  },
  {
    name: 'master.category.update',
    module: 'master.category',
    action: 'update',
    description: 'Update Category',
  },
  {
    name: 'master.category.delete',
    module: 'master.category',
    action: 'delete',
    description: 'Delete Category',
  },

  // ERP Sub-category
  {
    name: 'master.sub-category.create',
    module: 'master.sub-category',
    action: 'create',
    description: 'Create Sub-category',
  },
  {
    name: 'master.sub-category.read',
    module: 'master.sub-category',
    action: 'read',
    description: 'Read Sub-category',
  },
  {
    name: 'master.sub-category.update',
    module: 'master.sub-category',
    action: 'update',
    description: 'Update Sub-category',
  },
  {
    name: 'master.sub-category.delete',
    module: 'master.sub-category',
    action: 'delete',
    description: 'Delete Sub-category',
  },
  // ERP UOM
  // {
  //   name: 'master.uom.create',
  //   module: 'master.uom',
  //   action: 'create',
  //   description: 'Create UOM',
  // },
  // {
  //   name: 'master.uom.read',
  //   module: 'master.uom',
  //   action: 'read',
  //   description: 'Read UOM',
  // },
  // {
  //   name: 'master.uom.update',
  //   module: 'master.uom',
  //   action: 'update',
  //   description: 'Update UOM',
  // },
  // {
  //   name: 'master.uom.delete',
  //   module: 'master.uom',
  //   action: 'delete',
  //   description: 'Delete UOM',
  // },
  // POS Master - Promos
  {
    name: 'master.promo.create',
    module: 'master.promo',
    action: 'create',
    description: 'Create Promo',
  },
  {
    name: 'master.promo.read',
    module: 'master.promo',
    action: 'read',
    description: 'Read Promo',
  },
  {
    name: 'master.promo.update',
    module: 'master.promo',
    action: 'update',
    description: 'Update Promo',
  },
  {
    name: 'master.promo.delete',
    module: 'master.promo',
    action: 'delete',
    description: 'Delete Promo',
  },
  // POS Master - Coupons
  {
    name: 'master.coupon.create',
    module: 'master.coupon',
    action: 'create',
    description: 'Create Coupon',
  },
  {
    name: 'master.coupon.read',
    module: 'master.coupon',
    action: 'read',
    description: 'Read Coupon',
  },
  {
    name: 'master.coupon.update',
    module: 'master.coupon',
    action: 'update',
    description: 'Update Coupon',
  },
  {
    name: 'master.coupon.delete',
    module: 'master.coupon',
    action: 'delete',
    description: 'Delete Coupon',
  },
  // POS Master - Alliances
  {
    name: 'master.alliance.create',
    module: 'master.alliance',
    action: 'create',
    description: 'Create Alliance',
  },
  {
    name: 'master.alliance.read',
    module: 'master.alliance',
    action: 'read',
    description: 'Read Alliance',
  },
  {
    name: 'master.alliance.update',
    module: 'master.alliance',
    action: 'update',
    description: 'Update Alliance',
  },
  {
    name: 'master.alliance.delete',
    module: 'master.alliance',
    action: 'delete',
    description: 'Delete Alliance',
  },
  // KPI
  {
    name: 'hr.kpi.read',
    description: 'Read KPI',
  },
  {
    name: 'hr.kpi.create',
    description: 'Create KPI',
  },
  {
    name: 'hr.kpi.update',
    description: 'Update KPI',
  },
  {
    name: 'hr.kpi.delete',
    description: 'Delete KPI',
  },
  {
    name: 'hr.kpi.approve',
    description: 'Approve KPI Review',
  },

  // ── Task Assessment ────────────────────────────────────────────────────────
  // Projects
  { name: 'task.project.read', description: 'Read Task Projects' },
  { name: 'task.project.create', description: 'Create Task Project' },
  { name: 'task.project.update', description: 'Update Task Project' },
  { name: 'task.project.delete', description: 'Delete Task Project' },
  {
    name: 'task.project.manage-members',
    description: 'Manage Task Project Members',
  },
  // Tasks
  { name: 'task.read', description: 'Read Tasks' },
  { name: 'task.create', description: 'Create Task' },
  { name: 'task.update', description: 'Update Task' },
  { name: 'task.delete', description: 'Delete Task' },
  { name: 'task.assign', description: 'Assign Task to Employees' },
  {
    name: 'task.manage-all',
    description: 'View All Tasks Regardless of Assignment',
  },
  // Comments
  { name: 'task.comment.read', description: 'Read Task Comments' },
  { name: 'task.comment.create', description: 'Create Task Comment' },
  { name: 'task.comment.update', description: 'Update Task Comment' },
  { name: 'task.comment.delete', description: 'Delete Task Comment' },
  // Reviews & Reports
  { name: 'task.review', description: 'Submit Task Quality Review' },
  { name: 'task.report.read', description: 'Read Task Reports' },

  // ── ERP Dashboard ──────────────────────────────────────────────────────────
  // Overview Tab
  { name: 'erp.dashboard.view', description: 'View ERP Dashboard' },
  { name: 'erp.dashboard.overview.view', description: 'View ERP Dashboard Overview Tab' },
  { name: 'erp.dashboard.overview.export', description: 'Export ERP Dashboard Data' },
  // Analytics Tab
  { name: 'erp.dashboard.analytics.view', description: 'View ERP Dashboard Analytics Tab' },
  // Inventory Tab
  { name: 'erp.dashboard.inventory.view', description: 'View ERP Dashboard Inventory Tab' },
  { name: 'erp.dashboard.inventory.refresh', description: 'Refresh ERP Inventory Data' },

  // ── ERP Inventory ──────────────────────────────────────────────────────────
  { name: 'erp.inventory.view', description: 'View Inventory Dashboard' },
  { name: 'erp.inventory.explorer.view', description: 'View Inventory Explorer' },
  { name: 'erp.inventory.explorer.export', description: 'Export Inventory Explorer PDF' },
  { name: 'erp.inventory.transfer.create', description: 'Create Stock Transfer' },

  // ── ERP Inventory — Transactions ───────────────────────────────────────────
  { name: 'erp.inventory.stock-transfer.read', description: 'View Stock Transfer History' },
  { name: 'erp.inventory.delivery-note.read', description: 'View Delivery Notes' },
  { name: 'erp.inventory.delivery-note.create', description: 'Create Delivery Note' },
  { name: 'erp.inventory.stock-received.read', description: 'View Stock Received' },
  { name: 'erp.inventory.stock-received.update', description: 'Update Stock Received Status' },
  { name: 'erp.inventory.return-transfer.read', description: 'View Return Transfers' },
  { name: 'erp.inventory.return-transfer.create', description: 'Create Return Transfer' },

  // ── ERP Inventory — Warehouse ───────────────────────────────────────────────
  { name: 'erp.inventory.warehouse.view', description: 'View Warehouse List & Dashboard' },
  { name: 'erp.inventory.warehouse.create', description: 'Create Warehouse' },
  { name: 'erp.inventory.warehouse.update', description: 'Update Warehouse' },
  { name: 'erp.inventory.warehouse.delete', description: 'Delete Warehouse' },
  { name: 'erp.inventory.warehouse.inventory.view', description: 'View Warehouse Inventory Levels' },

  // ── ERP Items ───────────────────────────────────────────────────────────────
  { name: 'erp.item.read', description: 'View Items Catalog' },
  { name: 'erp.item.create', description: 'Create Item' },
  { name: 'erp.item.update', description: 'Update Item' },
  { name: 'erp.item.delete', description: 'Delete Item' },
  { name: 'erp.item.bulk-upload', description: 'Bulk Upload Items' },

  // ── ERP Procurement — Purchase Requisition ──────────────────────────────────
  { name: 'erp.procurement.pr.read', description: 'View Purchase Requisitions' },
  { name: 'erp.procurement.pr.create', description: 'Create Purchase Requisition' },
  { name: 'erp.procurement.pr.update', description: 'Update Purchase Requisition' },
  { name: 'erp.procurement.pr.delete', description: 'Delete Purchase Requisition' },
  { name: 'erp.procurement.pr.submit', description: 'Submit Purchase Requisition for Approval' },
  { name: 'erp.procurement.pr.approve', description: 'Approve / Reject Purchase Requisition' },

  // ── ERP Procurement — RFQ ───────────────────────────────────────────────────
  { name: 'erp.procurement.rfq.read', description: 'View RFQs' },
  { name: 'erp.procurement.rfq.create', description: 'Create RFQ' },
  { name: 'erp.procurement.rfq.update', description: 'Update RFQ' },
  { name: 'erp.procurement.rfq.delete', description: 'Delete RFQ' },
  { name: 'erp.procurement.rfq.add-vendors', description: 'Add Vendors to RFQ' },
  { name: 'erp.procurement.rfq.send', description: 'Mark RFQ as Sent' },

  // ── ERP Procurement — Vendor Quotation ─────────────────────────────────────
  { name: 'erp.procurement.vq.read', description: 'View Vendor Quotations' },
  { name: 'erp.procurement.vq.create', description: 'Create Vendor Quotation' },
  { name: 'erp.procurement.vq.update', description: 'Update Vendor Quotation' },
  { name: 'erp.procurement.vq.delete', description: 'Delete Vendor Quotation' },
  { name: 'erp.procurement.vq.submit', description: 'Submit Vendor Quotation' },
  { name: 'erp.procurement.vq.select', description: 'Select Vendor Quotation' },
  { name: 'erp.procurement.vq.compare', description: 'Compare Vendor Quotations' },

  // ── ERP Procurement — Purchase Order ───────────────────────────────────────
  { name: 'erp.procurement.po.read', description: 'View Purchase Orders' },
  { name: 'erp.procurement.po.create', description: 'Create Purchase Order' },
  { name: 'erp.procurement.po.update', description: 'Update Purchase Order Status' },

  // ── ERP Procurement — GRN (stub for cross-reference) ───────────────────────
  { name: 'erp.procurement.grn.create', description: 'Create Goods Receipt Note' },
  { name: 'erp.procurement.grn.read', description: 'View Goods Receipt Notes' },
  { name: 'erp.procurement.grn.update', description: 'Update GRN Status' },

  // ── ERP Procurement — Landed Cost ───────────────────────────────────────────
  { name: 'erp.procurement.landed-cost.read', description: 'View Landed Costs' },
  { name: 'erp.procurement.landed-cost.create', description: 'Create / Post Landed Cost' },

  // ── ERP Procurement — Purchase Invoice ──────────────────────────────────────
  { name: 'erp.procurement.pi.read', description: 'View Purchase Invoices' },
  { name: 'erp.procurement.pi.create', description: 'Create Purchase Invoice' },
  { name: 'erp.procurement.pi.update', description: 'Update Purchase Invoice' },
  { name: 'erp.procurement.pi.delete', description: 'Delete Purchase Invoice' },
  { name: 'erp.procurement.pi.post', description: 'Post Purchase Invoice' },

  // ── ERP Procurement — Purchase Returns ─────────────────────────────────────
  { name: 'erp.procurement.pret.read', description: 'View Purchase Returns' },
  { name: 'erp.procurement.pret.create', description: 'Create Purchase Return' },
  { name: 'erp.procurement.pret.update', description: 'Update Purchase Return' },
  { name: 'erp.procurement.pret.delete', description: 'Delete Purchase Return' },

  // ── ERP Procurement — Debit Notes ──────────────────────────────────────────
  { name: 'erp.procurement.dn.read', description: 'View Debit Notes' },
  { name: 'erp.procurement.dn.create', description: 'Create Debit Note' },

  { name: 'erp.procurement.dn.update', description: 'Update Debit Note' },
  { name: 'erp.procurement.dn.delete', description: 'Delete Debit Note' },

  // ── ERP Procurement — Vendors ──────────────────────────────────────────────
  { name: 'erp.procurement.vendor.read', description: 'View Vendors' },
  { name: 'erp.procurement.vendor.create', description: 'Create Vendor' },
  { name: 'erp.procurement.vendor.update', description: 'Update Vendor' },
  { name: 'erp.procurement.vendor.delete', description: 'Delete Vendor' },

  // ── ERP Claims ─────────────────────────────────────────────────────────────
  { name: 'erp.claims.read', description: 'View Claims' },
  { name: 'erp.claims.create', description: 'Create Claim' },
  { name: 'erp.claims.update', description: 'Update Claim' },
  { name: 'erp.claims.delete', description: 'Delete Claim' },
  { name: 'erp.claims.approve', description: 'Approve/Reject Claim' },

  // ── ERP Sales — Customers ──────────────────────────────────────────────────
  { name: 'erp.sales.customer.read', description: 'View Customers' },
  { name: 'erp.sales.customer.create', description: 'Create Customer' },
  { name: 'erp.sales.customer.update', description: 'Update Customer' },
  { name: 'erp.sales.customer.delete', description: 'Delete Customer' },

  // ── ERP Sales — Orders ─────────────────────────────────────────────────────
  { name: 'erp.sales.order.read', description: 'View Sales Orders' },
  { name: 'erp.sales.order.create', description: 'Create Sales Order' },
  { name: 'erp.sales.order.update', description: 'Update Sales Order' },
  { name: 'erp.sales.order.delete', description: 'Delete Sales Order' },
  { name: 'erp.sales.order.approve', description: 'Approve Sales Order' },

  // ── ERP Sales — Invoices ───────────────────────────────────────────────────
  { name: 'erp.sales.invoice.read', description: 'View Sales Invoices' },
  { name: 'erp.sales.invoice.create', description: 'Create Sales Invoice' },
  { name: 'erp.sales.invoice.update', description: 'Update Sales Invoice' },
  { name: 'erp.sales.invoice.delete', description: 'Delete Sales Invoice' },
  { name: 'erp.sales.invoice.post', description: 'Post/Finalize Sales Invoice' },

  // ── ERP Sales — Delivery Challans ──────────────────────────────────────────
  { name: 'erp.sales.dc.read', description: 'View Delivery Challans' },
  { name: 'erp.sales.dc.create', description: 'Create Delivery Challan' },
  { name: 'erp.sales.dc.update', description: 'Update Delivery Challan' },
  { name: 'erp.sales.dc.delete', description: 'Delete Delivery Challan' },
  { name: 'erp.sales.dc.deliver', description: 'Mark Delivery Challan as Delivered' },
  { name: 'erp.sales.dc.cancel', description: 'Cancel Delivery Challan' },

   // ── POS Inventory ──────────────────────────────────────────────────────────
  { name: 'pos.inventory.view', description: 'View POS Inventory Stock' },
  { name: 'pos.inventory.receiving.view', description: 'View POS Stock Receiving (Warehouse → Outlet)' },
  { name: 'pos.inventory.receiving.accept', description: 'Accept Incoming Stock from Warehouse' },
  { name: 'pos.inventory.returns.view', description: 'View POS Return Requests (Outlet → Warehouse)' },
  { name: 'pos.inventory.returns.approve', description: 'Approve Return Requests to Warehouse' },
  { name: 'pos.inventory.inbound.view', description: 'View POS Inbound Transfers (Outlet → Outlet)' },
  { name: 'pos.inventory.inbound.accept', description: 'Accept Inbound Outlet-to-Outlet Transfers' },
  { name: 'pos.inventory.outbound.view', description: 'View POS Outbound Transfer Requests' },
  { name: 'pos.inventory.outbound.approve', description: 'Approve Outbound Outlet-to-Outlet Transfers' },
  { name: 'pos.inventory.receipt.view', description: 'View POS Stock Receipts & Print Slips' },
  { name: 'pos.inventory.transfer.create', description: 'Create Transfer Request from POS' },
  { name: 'pos.stock.move', description: 'Execute Direct Stock Movement (Inbound/Outbound/Transfer)' },

  // ── POS — New Sale ──────────────────────────────────────────────────────────
  { name: 'pos.sale.create', description: 'Create a New POS Sale' },
  { name: 'pos.sale.item-discount', description: 'Apply Per-Item Discount Override on Cart' },
  { name: 'pos.sale.transit-override', description: 'Mark Items as Stock-in-Transit (sell without stock)' },

  // ── POS — Checkout / Discounts ──────────────────────────────────────────────
  { name: 'pos.checkout.promo', description: 'Apply Promo Campaign Discount at Checkout' },
  { name: 'pos.checkout.coupon', description: 'Apply Coupon / Voucher Code at Checkout' },
  { name: 'pos.checkout.alliance', description: 'Apply Alliance / Bank Card Discount at Checkout' },
  { name: 'pos.checkout.manual-discount', description: 'Apply Manual Order-Level Discount at Checkout' },
  { name: 'pos.checkout.add-customer', description: 'Add New Customer During Checkout' },

  // ── POS — Holds ─────────────────────────────────────────────────────────────
  { name: 'pos.hold.create', description: 'Place a Cart on Hold' },
  { name: 'pos.hold.resume', description: 'Resume a Held Order' },
  { name: 'pos.hold.view', description: 'View Hold Orders List' },

  // ── POS — Sales History ─────────────────────────────────────────────────────
  { name: 'pos.sales.history.view', description: 'View POS Sales History' },
  { name: 'pos.sales.history.print', description: 'Print Receipt from Sales History' },
  { name: 'pos.sales.history.update-tender', description: 'Update Payment Tender on Completed Order' },

  // ── POS — Returns / Exchanges / Claims ─────────────────────────────────────
  { name: 'pos.return.create', description: 'Process a Return / Refund' },
  { name: 'pos.exchange.create', description: 'Process an Exchange' },
  { name: 'pos.claim.create', description: 'Submit a Claim to ERP' },

  // ── POS — Customers ─────────────────────────────────────────────────────────
  { name: 'pos.customer.view', description: 'View POS Customer List' },
  { name: 'pos.customer.create', description: 'Create a New POS Customer' },
  { name: 'pos.customer.update', description: 'Edit an Existing POS Customer' },

  // ── POS — Customer Ledger ───────────────────────────────────────────────────
  { name: 'pos.ledger.view', description: 'View Customer Credit Ledger' },
  { name: 'pos.ledger.payment', description: 'Record Customer Credit Payment' },
  { name: 'pos.ledger.credit-limit', description: 'Set / Change Customer Credit Limit' },

  // ── POS — Vouchers ──────────────────────────────────────────────────────────
  { name: 'pos.voucher.view', description: 'View Issued Vouchers' },
  { name: 'pos.voucher.create', description: 'Issue a New Voucher' },
  { name: 'pos.voucher.void', description: 'Void / Deactivate a Voucher' },
  { name: 'pos.voucher.delete', description: 'Delete an Unused Voucher' },

  // ── POS — Shifts / Cash Drawer ──────────────────────────────────────────────
  { name: 'pos.shift.view', description: 'View Shift History' },
  { name: 'pos.shift.open', description: 'Open a New Shift' },
  { name: 'pos.shift.close', description: 'Close the Current Shift' },

  // ── POS — Terminal ──────────────────────────────────────────────────────────
  { name: 'pos.terminal.settings', description: 'Access & Save Terminal Settings' },
  { name: 'pos.terminal.logout', description: 'Deregister / Logout Terminal' },

  // ── POS — Dashboard ─────────────────────────────────────────────────────────
  { name: 'pos.dashboard.view', description: 'View POS Dashboard & Stats' },

];

