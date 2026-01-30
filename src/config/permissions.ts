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
    name:'master.institute.create',
    module:'master.institute',
    action:'create',
    description:'Create Institute',
  },
  {
    name:'master.institute.read',
    module:'master.institute',
    action:'read',
    description:'Read Institute',
  },
  {
    name:'master.institute.update',
  
    description:'Update Institute',
  },
  {
    name:'master.institute.delete',
    module:'master.institute',
    action:'delete',
    description:'Delete Institute',
  }, 
  // Qualification
  {
    name:'master.qualification.create',
    module:'master.qualification',
    action:'create',
    description:'Create Qualification',
  },
  {
    name:'master.qualification.read',
    module:'master.qualification',
    action:'read',
    description:'Read Qualification',
  },
  {
    name:'master.qualification.update',
    module:'master.qualification',
    action:'update',
    description:'Update Qualification',
  },
  {
    name:'master.qualification.delete',
    module:'master.qualification',
    action:'delete',
    description:'Delete Qualification',
  },
  // Designation
  {
    name:'master.designation.create',
    module:'master.designation',
    action:'create',
    description:'Create Designation',
  },
  {
    name:'master.designation.read',
    module:'master.designation',
    action:'read',
    description:'Read Designation',
  },
  {
    name:'master.designation.update',
    module:'master.designation',
    action:'update',
    description:'Update Designation',
  },
  {
    name:'master.designation.delete',
    module:'master.designation',
    action:'delete',
    description:'Delete Designation',
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
   
    description: 'Update Leaves Policy'
  },
  {
    name: 'master.leaves-policy.delete',
    description: 'Delete Leaves Policy'
  },
  // Equipment
  {
    name: 'master.equipment.create',
    
    description: 'Create Equipment'
  },
  {
    name: 'master.equipment.read',
   
    description: 'Read Equipment'
  },
  {
    name: 'master.equipment.update',
  
    description: 'Update Equipment'
  },
  {
    name: 'master.equipment.delete',
    description: 'Delete Equipment'
  },
  // Salary Breakup
  {
    name: 'master.salary-breakup.create',
   
    description: 'Create Salary Breakup'
  },
  {
    name: 'master.salary-breakup.read',
   
    description: 'Read Salary Breakup'
  },
  {
    name: 'master.salary-breakup.update',
   
    description: 'Update Salary Breakup'
  },
  {
    name: 'master.salary-breakup.delete',
  
    description: 'Delete Salary Breakup'
  },
  // EOBI
  {
    name: 'master.eobi.create',

    description: 'Create EOBI'
  },
  {
    name: 'master.eobi.read',
 
    description: 'Read EOBI'
  },
  {
    name: 'master.eobi.update',
    
    description: 'Update EOBI'
  },
  {
    name: 'master.eobi.delete',
 
    description: 'Delete EOBI'
  },
  // Social Security
  {
    name: 'master.social-security.create',

    description: 'Create Social Security'
  },
  {
    name: 'master.social-security.read',
  
    description: 'Read Social Security'
  },
  {
    name: 'master.social-security.update',
   
    description: 'Update Social Security'
  },
  {
    name: 'master.social-security.delete',
    
    description: 'Delete Social Security'
  },
  // Tax Slabs
  {
    name: 'master.tax-slab.create',
   
    description: 'Create Tax Slab'
  },
  {
    name: 'master.tax-slab.read',
    
    description: 'Read Tax Slab'
  },
  {
    name: 'master.tax-slab.update',
     description: 'Update Tax Slab'
  },
  {
    name: 'master.tax-slab.delete',
    
    description: 'Delete Tax Slab'
  },
  // Provident Fund
  {
    name: 'master.provident-fund.create',
   
    
    description: 'Create Provident Fund'
  },
  {
    name: 'master.provident-fund.read',
    
    description: 'Read Provident Fund'
  },
  {
    name: 'master.provident-fund.update',
    
    description: 'Update Provident Fund'
  },
  {
    name: 'master.provident-fund.delete',
    
    description: 'Delete Provident Fund'
  },
  // Bonus Types
  {
    name: 'master.bonus-type.create',
    
    description: 'Create Bonus Type'
  },
  {
    name: 'master.bonus-type.read',
   
    description: 'Read Bonus Type'
  },
  {
    name: 'master.bonus-type.update',
   
    description: 'Update Bonus Type'  
  },
  {
    name: 'master.bonus-type.delete',
    
    description: 'Delete Bonus Type'
  },
  // Allowance Head
  {
    name: 'master.allowance-head.create',
   
    description: 'Create Allowance Head'
  },
  {
    name: 'master.allowance-head.read',
   
    description: 'Read Allowance Head'
  },
  {
    name: 'master.allowance-head.update',
    
    description: 'Update Allowance Head'
  },
  {
    name: 'master.allowance-head.delete',
  
    description: 'Delete Allowance Head'
  },
  // Deduction Head
  {
    name: 'master.deduction-head.create',
   
    description: 'Create Deduction Head'
  },
  {
    name: 'master.deduction-head.read',
  
    description: 'Read Deduction Head'
  },
  {
    name: 'master.deduction-head.update',
   
    description: 'Update Deduction Head'
  },
  {
    name: 'master.deduction-head.delete',
   
    description: 'Delete Deduction Head'
  },
  // Bank
  {
    name: 'master.bank.create',
    description: 'Create Bank'
  },
  {
    name: 'master.bank.read',
    description: 'Read Bank'
  },
  {
    name: 'master.bank.update',
    description: 'Update Bank'
  },
  {
    name: 'master.bank.delete',
    description: 'Delete Bank'
  },

              // HR MODULES
  //Dashboard
  {
    name:'hr.dashboard.view',
    description:'View HR Dashboard'
  },
  //Employee
  {
    name:'hr.employee.create',
    description:'Create Employee'
  },
  {
    name:'hr.employee.read',
    description:'Read Employee'
  },
  {
    name:'hr.employee.transfer',
    description:'Transfer Employee'
  },
    {
    name:'hr.employee.user-account',
    description:'User Account'
  },
  {
    name:'hr.employee.update',
    description:'Update Employee'
  },
  {
    name:'hr.employee.delete',
    description:'Delete Employee'
  },
  //Exit Clearance
  {
    name:'hr.exit-clearance.create',
    description:'Exit Clearance'
  },
  {
    name:'hr.exit-clearance.read',
    description:'Read Exit Clearance'
  },
  {
    name:'hr.exit-clearance.update',
    description:'Update Exit Clearance'
  },
  {
    name:'hr.exit-clearance.delete',
    description:'Delete Exit Clearance'
  },
  //Attendance
  {
    name:'hr.attendance.view',
    description:'View Attendance'
  },
  {
    name:'hr.attendance.create',
    description:'Create Attendance'
  },
  {
    name:'hr.attendance.update',
    description:'Update Attendance'
  },
  {
    name:'hr.attendance.delete',
    description:'Delete Attendance'
  },
  {
    name:'hr.attendance.summary',
    description:'Attendance Summary'
  },
  {
    name:'hr.attendance.request',
    description:'Attendance Request'
  },
  {
    name:'hr.attendance.request-list',
    description:'Attendance Request List'
  },
  {
    name:'hr.attendance.exemptions',
    description:'Attendance Exemptions'
  },
  {
    name:'hr.attendance.exemptions-list',
    description:'Attendance Exemptions List'
  },
 
  // working hour Policy
  {
    name:'hr.working-hour-policy.create',
    description:'Create Working Hour Policy'
  },
  {
    name:'hr.working-hour-policy.read',
    description:'Read Working Hour Policy'
  },
  {
    name:'hr.working-hour-policy.update',
    description:'Update Working Hour Policy'
  },
  {
    name:'hr.working-hour-policy.delete',
    description:'Delete Working Hour Policy'
  },
  {
    name:'hr.working-hour-policy.assign',
    description:'Assign Working Hour Policy'
  },
  {
    name:'hr.working-hour-policy.assign-list',
    description:'Assign Working Hour Policy List'
  },
  // Holiday 
  {
    name:'hr.holiday.create',
    description:'Create Holiday'
  },
  {
    name:'hr.holiday.read',
    description:'Read Holiday'
  },
  {
    name:'hr.holiday.update',
    description:'Update Holiday'
  },
  {
    name:'hr.holiday.delete',
    description:'Delete Holiday'
  },
  //Leave
  {
    name:'hr.leave.create',
    description:'Create Leave'
  },
  {
    name:'hr.leave.read',
    description:'Read Leave'
  },
  {
    name:'hr.leave.update',
    description:'Update Leave'
  },
  {
    name:'hr.leave.delete',
    description:'Delete Leave'
  },
  // Loan Request
  {
    name: 'hr.loan-request.read',
    description: 'Read Loan Request'
  },
  {
    name: 'hr.loan-request.create',
    description: 'Create Loan Request'
  },
  {
    name: 'hr.loan-request.update',
    description: 'Update Loan Request'
  },
  {
    name: 'hr.loan-request.delete',
    description: 'Delete Loan Request'
  },
  {
    name: 'hr.loan-request.approve',
    description: 'Approve Loan Request'
  },
  // Leave Encashment
  {
    name: 'hr.leave-encashment.read',
    description: 'Read Leave Encashment'
  },
  {
    name: 'hr.leave-encashment.create',
    description: 'Create Leave Encashment'
  },
  {
    name: 'hr.leave-encashment.update',
    description: 'Update Leave Encashment'
  },
  {
    name: 'hr.leave-encashment.delete',
    description: 'Delete Leave Encashment'
  },
  {
    name: 'hr.leave-encashment.approve',
    description: 'Approve Leave Encashment'
  },
  // Attendance Request Query
  {
    name: 'hr.attendance-request-query.read',
    description: 'Read Attendance Request Query'
  },
  {
    name: 'hr.attendance-request-query.create',
    description: 'Create Attendance Request Query'
  },
  {
    name: 'hr.attendance-request-query.update',
    description: 'Update Attendance Request Query'
  },
  {
    name: 'hr.attendance-request-query.delete',
    description: 'Delete Attendance Request Query'
  },
  {
    name: 'hr.attendance-request-query.approve',
    description: 'Approve Attendance Request Query'
  },
  // Advance Salary
  {
    name: 'hr.advance-salary.read',
    description: 'Read Advance Salary'
  },
  {
    name: 'hr.advance-salary.create',
    description: 'Create Advance Salary'
  },
  {
    name: 'hr.advance-salary.update',
    description: 'Update Advance Salary'
  },
  {
    name: 'hr.advance-salary.delete',
    description: 'Delete Advance Salary'
  },
  {
    name: 'hr.advance-salary.approve',
    description: 'Approve Advance Salary'
  },
  // Request Forwarding
  {
    name: 'hr.request-forwarding.view',
    description: 'View Request Forwarding'
  },
  {
    name: 'hr.request-forwarding.manage',
    description: 'Manage Request Forwarding'
  },
  {
    name: 'hr.request-forwarding.attendance',
    description: 'Request Forwarding Attendance'
  },
  {
    name: 'hr.request-forwarding.advance-salary',
    description: 'Request Forwarding Advance Salary'
  },
  {
    name: 'hr.request-forwarding.loan',
    description: 'Request Forwarding Loan'
  },
  {
    name: 'hr.request-forwarding.leave-application',
    description: 'Request Forwarding Leave Application'
  },
  {
    name: 'hr.request-forwarding.leave-encashment',
    description: 'Request Forwarding Leave Encashment'
  },
  // Payroll
  {
    name: 'hr.payroll.read',
    description: 'Read Payroll'
  },
  {
    name: 'hr.payroll.create',
    description: 'Create Payroll'
  },
  {
    name: 'hr.payroll.update',
    description: 'Update Payroll'
  },
  {
    name: 'hr.payroll.delete',
    description: 'Delete Payroll'
  },
  // Increment
  {
    name: 'hr.increment.read',
    description: 'Read Increment'
  },
  {
    name: 'hr.increment.create',
    description: 'Create Increment'
  },
  {
    name: 'hr.increment.update',
    description: 'Update Increment'
  },
  {
    name: 'hr.increment.delete',
    description: 'Delete Increment'
  },
  {
    name: 'hr.increment.approve',
    description: 'Approve Increment'
  },
  // Bonus
  {
    name: 'hr.bonus.read',
    description: 'Read Bonus'
  },
  {
    name: 'hr.bonus.create',
    description: 'Create Bonus'
  },
  {
    name: 'hr.bonus.update',
    description: 'Update Bonus'
  },
  {
    name: 'hr.bonus.delete',
    description: 'Delete Bonus'
  },
  {
    name: 'hr.bonus.approve',
    description: 'Approve Bonus'
  },
  // Salary Sheet
  {
    name: 'hr.salary-sheet.read',
    description: 'Read Salary Sheet'
  },
  {
    name: 'hr.salary-sheet.create',
    description: 'Create Salary Sheet'
  },
  {
    name: 'hr.salary-sheet.update',
    description: 'Update Salary Sheet'
  },
  {
    name: 'hr.salary-sheet.delete',
    description: 'Delete Salary Sheet'
  },
  // Allowance
  {
    name: 'hr.allowance.read',
    description: 'Read Allowance'
  },
  {
    name: 'hr.allowance.create',
    description: 'Create Allowance'
  },
  {
    name: 'hr.allowance.update',
    description: 'Update Allowance'
  },
  {
    name: 'hr.allowance.delete',
    description: 'Delete Allowance'
  },
  {
    name: 'hr.allowance.approve',
    description: 'Approve Allowance'
  },
  // Deduction
  {
    name: 'hr.deduction.read',
    description: 'Read Deduction'
  },
  {
    name: 'hr.deduction.create',
    description: 'Create Deduction'
  },
  {
    name: 'hr.deduction.update',
    description: 'Update Deduction'
  },
  {
    name: 'hr.deduction.delete',
    description: 'Delete Deduction'
  },
  {
    name: 'hr.deduction.approve',
    description: 'Approve Deduction'
  },
  // Provident Fund (Employee Operations)
  {
    name: 'hr.provident-fund.read',
    description: 'Read Employee Provident Fund'
  },
  {
    name: 'hr.provident-fund.create',
    description: 'Create Employee Provident Fund'
  },
  {
    name: 'hr.provident-fund.update',
    description: 'Update Employee Provident Fund'
  },
  {
    name: 'hr.provident-fund.delete',
    description: 'Delete Employee Provident Fund'
  },
  // Rebate
  {
    name: 'hr.rebate.read',
    description: 'Read Rebate'
  },
  {
    name: 'hr.rebate.create',
    description: 'Create Rebate'
  },
  {
    name: 'hr.rebate.update',
    description: 'Update Rebate'
  },
  {
    name: 'hr.rebate.delete',
    description: 'Delete Rebate'
  },
  // Rebate Nature
  {
    name: 'hr.rebate-nature.read',
    description: 'Read Rebate Nature'
  },
  {
    name: 'hr.rebate-nature.create',
    description: 'Create Rebate Nature'
  },
  {
    name: 'hr.rebate-nature.update',
    description: 'Update Rebate Nature'
  },
  {
    name: 'hr.rebate-nature.delete',
    description: 'Delete Rebate Nature'
  },
  // Social Security (Employee Operations)
  {
    name: 'hr.social-security.read',
    description: 'Read Employee Social Security'
  },
  {
    name: 'hr.social-security.create',
    description: 'Create Employee Social Security'
  },
  {
    name: 'hr.social-security.update',
    description: 'Update Employee Social Security'
  },
  {
    name: 'hr.social-security.delete',
    description: 'Delete Employee Social Security'
  },
]