-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "SupplierNature" AS ENUM ('GOODS', 'SERVICES');

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('LOCAL', 'INTERNATIONAL');

-- CreateEnum
CREATE TYPE "PayrollRequestType" AS ENUM ('advance_salary', 'overtime_request', 'leave_encashment', 'pf_withdrawal', 'leave_application', 'attendance_request_query', 'loan_request', 'other');

-- CreateEnum
CREATE TYPE "PayrollApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'auto_approved', 'cancelled', 'forwarded');

-- CreateEnum
CREATE TYPE "AutoApprovalTrigger" AS ENUM ('none', 'amount_below_threshold', 'amount_above_threshold', 'time_based', 'manual_override');

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'present',
    "isRemote" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30),
    "workingHours" DECIMAL(65,30),
    "overtimeHours" DECIMAL(65,30),
    "lateMinutes" INTEGER,
    "earlyLeaveMinutes" INTEGER,
    "breakDuration" INTEGER,
    "notes" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRequestQuery" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "employeeName" TEXT,
    "department" TEXT,
    "subDepartment" TEXT,
    "attendanceDate" TIMESTAMP(3) NOT NULL,
    "clockInTimeRequest" TEXT,
    "clockOutTimeRequest" TEXT,
    "breakIn" TEXT,
    "breakOut" TEXT,
    "query" TEXT NOT NULL,
    "approval1" TEXT,
    "approval1Status" TEXT,
    "approval1Date" TIMESTAMP(3),
    "approval2" TEXT,
    "approval2Status" TEXT,
    "approval2Date" TIMESTAMP(3),
    "remarks" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRequestQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveApplication" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "dayType" TEXT NOT NULL DEFAULT 'fullDay',
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "reasonForLeave" TEXT NOT NULL,
    "addressWhileOnLeave" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approval1" TEXT,
    "approval1Status" TEXT,
    "approval1Date" TIMESTAMP(3),
    "approval2" TEXT,
    "approval2Status" TEXT,
    "approval2Date" TIMESTAMP(3),
    "remarks" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceExemption" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "employeeName" TEXT,
    "department" TEXT,
    "subDepartment" TEXT,
    "attendanceDate" TIMESTAMP(3) NOT NULL,
    "flagType" TEXT NOT NULL,
    "exemptionType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approval1" TEXT,
    "approval1Status" TEXT,
    "approval1Date" TIMESTAMP(3),
    "approval2" TEXT,
    "approval2Status" TEXT,
    "approval2Date" TIMESTAMP(3),
    "remarks" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceExemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingHoursPolicyAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workingHoursPolicyId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkingHoursPolicyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "fatherHusbandName" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "subDepartmentId" TEXT,
    "employeeGradeId" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "designationId" TEXT NOT NULL,
    "maritalStatusId" TEXT,
    "employmentStatusId" TEXT,
    "probationExpiryDate" TIMESTAMP(3),
    "cnicNumber" TEXT NOT NULL,
    "cnicExpiryDate" TIMESTAMP(3),
    "lifetimeCnic" BOOLEAN NOT NULL DEFAULT false,
    "joiningDate" TIMESTAMP(3),
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "emergencyContactNumber" TEXT,
    "emergencyContactPerson" TEXT,
    "personalEmail" TEXT,
    "officialEmail" TEXT,
    "countryId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "area" TEXT,
    "employeeSalary" DECIMAL(65,30) NOT NULL,
    "eobi" BOOLEAN NOT NULL DEFAULT false,
    "eobiId" TEXT,
    "eobiCode" TEXT,
    "eobiNumber" TEXT,
    "eobiDocumentUrl" TEXT,
    "documentUrls" JSONB,
    "providentFund" BOOLEAN NOT NULL DEFAULT false,
    "overtimeApplicable" BOOLEAN NOT NULL DEFAULT false,
    "daysOff" TEXT,
    "reportingManager" TEXT,
    "workingHoursPolicyId" TEXT NOT NULL,
    "locationId" TEXT,
    "allocationId" TEXT,
    "leavesPolicyId" TEXT NOT NULL,
    "allowRemoteAttendance" BOOLEAN NOT NULL DEFAULT false,
    "currentAddress" TEXT,
    "permanentAddress" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountTitle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isRejoined" BOOLEAN NOT NULL DEFAULT false,
    "originalJoiningDate" TIMESTAMP(3),
    "lastExitDate" TIMESTAMP(3),
    "rejoinCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "socialSecurityInstitutionId" TEXT,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeRejoiningHistory" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "previousEmployeeId" TEXT NOT NULL,
    "newEmployeeId" TEXT NOT NULL,
    "previousAttendanceId" TEXT NOT NULL,
    "newAttendanceId" TEXT NOT NULL,
    "previousExitDate" TIMESTAMP(3) NOT NULL,
    "rejoiningDate" TIMESTAMP(3) NOT NULL,
    "previousDepartmentId" TEXT,
    "newDepartmentId" TEXT,
    "previousDesignationId" TEXT,
    "newDesignationId" TEXT,
    "previousSalary" DECIMAL(65,30),
    "newSalary" DECIMAL(65,30),
    "previousValues" JSONB,
    "newValues" JSONB,
    "changedFields" JSONB,
    "remarks" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeRejoiningHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTransferHistory" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "previousLocationId" TEXT,
    "newLocationId" TEXT,
    "previousCityId" TEXT,
    "newCityId" TEXT,
    "previousStateId" TEXT,
    "newStateId" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeTransferHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeQualification" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "instituteId" TEXT,
    "cityId" TEXT,
    "stateId" TEXT,
    "year" INTEGER,
    "grade" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeEquipment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "assignedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "notes" TEXT,
    "metadata" JSONB,
    "assignedById" TEXT,
    "returnedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitClearance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "designation" TEXT,
    "department" TEXT,
    "subDepartment" TEXT,
    "location" TEXT,
    "leavingReason" TEXT,
    "contractEnd" TIMESTAMP(3),
    "lastWorkingDate" TIMESTAMP(3) NOT NULL,
    "reportingManager" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itAccessControl" BOOLEAN NOT NULL DEFAULT false,
    "itPasswordInactivated" BOOLEAN NOT NULL DEFAULT false,
    "itLaptopReturned" BOOLEAN NOT NULL DEFAULT false,
    "itEquipment" BOOLEAN NOT NULL DEFAULT false,
    "itWifiDevice" BOOLEAN NOT NULL DEFAULT false,
    "itMobileDevice" BOOLEAN NOT NULL DEFAULT false,
    "itSimCard" BOOLEAN NOT NULL DEFAULT false,
    "itBillsSettlement" BOOLEAN NOT NULL DEFAULT false,
    "financeAdvance" BOOLEAN NOT NULL DEFAULT false,
    "financeLoan" BOOLEAN NOT NULL DEFAULT false,
    "financeOtherLiabilities" BOOLEAN NOT NULL DEFAULT false,
    "adminVehicle" BOOLEAN NOT NULL DEFAULT false,
    "adminKeys" BOOLEAN NOT NULL DEFAULT false,
    "adminOfficeAccessories" BOOLEAN NOT NULL DEFAULT false,
    "adminMobilePhone" BOOLEAN NOT NULL DEFAULT false,
    "adminVisitingCards" BOOLEAN NOT NULL DEFAULT false,
    "hrEobi" BOOLEAN NOT NULL DEFAULT false,
    "hrProvidentFund" BOOLEAN NOT NULL DEFAULT false,
    "hrIdCard" BOOLEAN NOT NULL DEFAULT false,
    "hrMedical" BOOLEAN NOT NULL DEFAULT false,
    "hrThumbImpression" BOOLEAN NOT NULL DEFAULT false,
    "hrLeavesRemaining" BOOLEAN NOT NULL DEFAULT false,
    "hrOtherCompensation" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitClearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartOfAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartOfAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barCode" TEXT,
    "hsCode" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate1" DOUBLE PRECISION DEFAULT 0,
    "taxRate2" DOUBLE PRECISION DEFAULT 0,
    "discountRate" DOUBLE PRECISION DEFAULT 0,
    "discountAmount" DOUBLE PRECISION DEFAULT 0,
    "discountStartDate" TIMESTAMP(3),
    "discountEndDate" TIMESTAMP(3),
    "case" TEXT,
    "band" TEXT,
    "movementType" TEXT,
    "heelHeight" TEXT,
    "width" TEXT,
    "brandId" TEXT,
    "divisionId" TEXT,
    "genderId" TEXT,
    "sizeId" TEXT,
    "silhouetteId" TEXT,
    "channelClassId" TEXT,
    "colorId" TEXT,
    "categoryId" TEXT,
    "subCategoryId" TEXT,
    "itemClassId" TEXT,
    "itemSubclassId" TEXT,
    "seasonId" TEXT,
    "uomId" TEXT,
    "segmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalVoucher" (
    "id" TEXT NOT NULL,
    "jvNo" TEXT NOT NULL,
    "jvDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalVoucherDetail" (
    "id" TEXT NOT NULL,
    "journalVoucherId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "credit" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalVoucherDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentVoucher" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "pvNo" TEXT NOT NULL,
    "pvDate" TIMESTAMP(3) NOT NULL,
    "refBillNo" TEXT,
    "billDate" TIMESTAMP(3),
    "chequeNo" TEXT,
    "chequeDate" TIMESTAMP(3),
    "creditAccountId" TEXT NOT NULL,
    "supplierId" TEXT,
    "creditAmount" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "isAdvance" BOOLEAN NOT NULL DEFAULT false,
    "isTaxApplicable" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "PaymentVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentVoucherDetail" (
    "id" TEXT NOT NULL,
    "paymentVoucherId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentVoucherDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptVoucher" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rvNo" TEXT NOT NULL,
    "rvDate" TIMESTAMP(3) NOT NULL,
    "refBillNo" TEXT,
    "billDate" TIMESTAMP(3),
    "chequeNo" TEXT,
    "chequeDate" TIMESTAMP(3),
    "debitAccountId" TEXT NOT NULL,
    "debitAmount" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "ReceiptVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptVoucherDetail" (
    "id" TEXT NOT NULL,
    "receiptVoucherId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "credit" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptVoucherDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "brand" TEXT,
    "name" TEXT NOT NULL,
    "nature" "SupplierNature",
    "type" "SupplierType" DEFAULT 'LOCAL',
    "address" TEXT,
    "city" TEXT,
    "country" TEXT DEFAULT 'Pakistan',
    "contactNo" TEXT,
    "email" TEXT,
    "website" TEXT,
    "cnicNo" TEXT,
    "ntnNo" TEXT,
    "strnNo" TEXT,
    "srbNo" TEXT,
    "praNo" TEXT,
    "ictNo" TEXT,
    "chartOfAccountId" TEXT NOT NULL,
    "paymentTerms" TEXT,
    "creditLimit" DECIMAL(15,2),
    "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantItemSetting" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "valuationMethod" TEXT NOT NULL DEFAULT 'WEIGHTED_AVG',
    "standardCost" DECIMAL(15,4),
    "averageCost" DECIMAL(15,4),
    "minStock" DECIMAL(15,4),
    "maxStock" DECIMAL(15,4),
    "reorderPoint" DECIMAL(15,4),
    "safetyStock" DECIMAL(15,4),
    "leadTimeDays" INTEGER,
    "preferredVendorId" TEXT,
    "isBatchActive" BOOLEAN NOT NULL DEFAULT false,
    "isSerialActive" BOOLEAN NOT NULL DEFAULT false,
    "shelfLifeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantItemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UomConversion" (
    "id" TEXT NOT NULL,
    "fromUomId" TEXT NOT NULL,
    "toUomId" TEXT NOT NULL,
    "factor" DECIMAL(15,6) NOT NULL,
    "operation" TEXT NOT NULL DEFAULT 'MULTIPLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UomConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "documentType" TEXT,
    "documentId" TEXT,
    "quantity" DECIMAL(15,4) NOT NULL,
    "unitCost" DECIMAL(15,4) NOT NULL,
    "totalValue" DECIMAL(15,4) NOT NULL,
    "quantityBalance" DECIMAL(15,4),
    "valueBalance" DECIMAL(15,4),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "loanTypeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "requestedDate" TIMESTAMP(3) NOT NULL,
    "repaymentStartMonthYear" TEXT,
    "numberOfInstallments" INTEGER,
    "reason" TEXT NOT NULL,
    "additionalDetails" TEXT,
    "approval1" TEXT,
    "approval1Status" TEXT,
    "approval1Date" TIMESTAMP(3),
    "approval2" TEXT,
    "approval2Status" TEXT,
    "approval2Date" TIMESTAMP(3),
    "remarks" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allowance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "allowanceHeadId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'specific',
    "adjustmentMethod" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT 'with_salary',
    "isTaxable" BOOLEAN NOT NULL DEFAULT false,
    "taxPercentage" DECIMAL(5,2),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allowance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deduction" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deductionHeadId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isTaxable" BOOLEAN NOT NULL DEFAULT false,
    "taxPercentage" DECIMAL(5,2),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceSalary" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "neededOn" TIMESTAMP(3) NOT NULL,
    "deductionMonth" TEXT NOT NULL,
    "deductionYear" TEXT NOT NULL,
    "deductionMonthYear" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approval1" TEXT,
    "approval1Status" TEXT,
    "approval1Date" TIMESTAMP(3),
    "approval2" TEXT,
    "approval2Status" TEXT,
    "approval2Date" TIMESTAMP(3),
    "remarks" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvanceSalary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimeRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "overtimeType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "weekdayOvertimeHours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "holidayOvertimeHours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approval1" TEXT,
    "approval1Status" TEXT,
    "approval1Date" TIMESTAMP(3),
    "approval2" TEXT,
    "approval2Status" TEXT,
    "approval2Date" TIMESTAMP(3),
    "remarks" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Increment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeGradeId" TEXT,
    "designationId" TEXT,
    "incrementType" TEXT NOT NULL,
    "incrementAmount" DECIMAL(10,2),
    "incrementPercentage" DECIMAL(5,2),
    "incrementMethod" TEXT NOT NULL,
    "salary" DECIMAL(10,2) NOT NULL,
    "promotionDate" TIMESTAMP(3) NOT NULL,
    "currentMonth" TEXT NOT NULL,
    "monthsOfIncrement" INTEGER NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Increment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bonus" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "bonusTypeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "calculationType" TEXT NOT NULL,
    "percentage" DECIMAL(5,2),
    "bonusMonth" TEXT NOT NULL,
    "bonusYear" TEXT NOT NULL,
    "bonusMonthYear" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'with_salary',
    "adjustmentMethod" TEXT NOT NULL DEFAULT 'distributed-remaining-months',
    "notes" TEXT,
    "isTaxable" BOOLEAN NOT NULL DEFAULT false,
    "taxPercentage" DECIMAL(5,2),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveEncashment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "encashmentDate" TIMESTAMP(3) NOT NULL,
    "encashmentDays" DECIMAL(5,2) NOT NULL,
    "encashmentAmount" DECIMAL(10,2) NOT NULL,
    "paymentMonth" TEXT NOT NULL,
    "paymentYear" TEXT NOT NULL,
    "paymentMonthYear" TEXT NOT NULL,
    "grossSalary" DECIMAL(10,2),
    "annualSalary" DECIMAL(10,2),
    "perDayAmount" DECIMAL(10,2),
    "approval1" TEXT,
    "approval1Status" TEXT,
    "approval1Date" TIMESTAMP(3),
    "approval2" TEXT,
    "approval2Status" TEXT,
    "approval2Date" TIMESTAMP(3),
    "remarks" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveEncashment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payroll" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,

    CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollDetail" (
    "id" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicSalary" DECIMAL(10,2) NOT NULL,
    "totalAllowances" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "attendanceDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "loanDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "advanceSalaryDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "eobiDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "providentFundDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overtimeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "bonusAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "leaveEncashmentAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "socialSecurityContributionAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "grossSalary" DECIMAL(10,2) NOT NULL,
    "netSalary" DECIMAL(10,2) NOT NULL,
    "salaryBreakup" JSONB DEFAULT '[]',
    "allowanceBreakup" JSONB DEFAULT '[]',
    "deductionBreakup" JSONB DEFAULT '[]',
    "taxBreakup" JSONB DEFAULT '{}',
    "attendanceBreakup" JSONB DEFAULT '{}',
    "overtimeBreakup" JSONB DEFAULT '[]',
    "bonusBreakup" JSONB DEFAULT '[]',
    "incrementBreakup" JSONB DEFAULT '[]',
    "accountNumber" TEXT,
    "bankName" TEXT,
    "paymentMode" TEXT DEFAULT 'Bank Transfer',
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "paymentDate" TIMESTAMP(3),

    CONSTRAINT "PayrollDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PFWithdrawal" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "withdrawalAmount" DECIMAL(10,2) NOT NULL,
    "withdrawalDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "monthYear" TEXT NOT NULL,
    "reason" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PFWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollApprovalRequest" (
    "id" TEXT NOT NULL,
    "requestType" "PayrollRequestType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "configurationId" TEXT,
    "currentLevel" INTEGER,
    "maxLevel" INTEGER,
    "status" "PayrollApprovalStatus" NOT NULL DEFAULT 'pending',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollApprovalLevel" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "approverType" TEXT NOT NULL,
    "departmentHeadMode" TEXT,
    "thresholdAmount" DECIMAL(10,2),
    "thresholdPercentage" DECIMAL(5,2),
    "autoApprovalTrigger" "AutoApprovalTrigger",
    "autoApprovalCondition" TEXT,
    "status" "PayrollApprovalStatus" NOT NULL DEFAULT 'pending',
    "assignedApproverId" TEXT,
    "assignedEmployeeId" TEXT,
    "departmentId" TEXT,
    "subDepartmentId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollApprovalLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollApprovalHistory" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "status" "PayrollApprovalStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "performedById" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,

    CONSTRAINT "PayrollApprovalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rebate" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "rebateNatureId" TEXT NOT NULL,
    "rebateAmount" DECIMAL(12,2) NOT NULL,
    "monthYear" TEXT NOT NULL,
    "attachment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remarks" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rebate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisitions" (
    "id" TEXT NOT NULL,
    "pr_number" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "department" TEXT,
    "request_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisition_items" (
    "id" TEXT NOT NULL,
    "purchase_requisition_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "description" TEXT,
    "required_qty" DECIMAL(15,4) NOT NULL,
    "needed_by_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisition_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfqs" (
    "id" TEXT NOT NULL,
    "rfq_number" TEXT NOT NULL,
    "purchase_requisition_id" TEXT NOT NULL,
    "rfq_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_vendors" (
    "id" TEXT NOT NULL,
    "rfq_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "response_status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_quotations" (
    "id" TEXT NOT NULL,
    "rfq_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "quotation_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_quotation_items" (
    "id" TEXT NOT NULL,
    "vendor_quotation_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "description" TEXT,
    "quoted_qty" DECIMAL(15,4) NOT NULL,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestForwardingConfiguration" (
    "id" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "approvalFlow" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestForwardingConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestForwardingApprovalLevel" (
    "id" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "approverType" TEXT NOT NULL,
    "departmentHeadMode" TEXT,
    "specificEmployeeId" TEXT,
    "departmentId" TEXT,
    "subDepartmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestForwardingApprovalLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchNumber" TEXT,
    "serialNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "manufacturingDate" TIMESTAMP(3),
    "quantity" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReserve" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "notes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "StockReserve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "movementNo" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "quantity" DECIMAL(15,4) NOT NULL,
    "batchNumber" TEXT,
    "serialNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "type" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "movementDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferRequest" (
    "id" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferRequestItem" (
    "id" TEXT NOT NULL,
    "transferRequestId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "batchNumber" TEXT,
    "fulfilledQty" DECIMAL(15,4) NOT NULL DEFAULT 0,

    CONSTRAINT "TransferRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "type" TEXT NOT NULL DEFAULT 'GENERAL',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "managerId" TEXT,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'BIN',
    "barcode" TEXT,
    "parentId" TEXT,
    "length" DECIMAL(10,2),
    "width" DECIMAL(10,2),
    "height" DECIMAL(10,2),
    "maxWeight" DECIMAL(10,2),
    "volume" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceRequestQuery_employeeId_idx" ON "AttendanceRequestQuery"("employeeId");

-- CreateIndex
CREATE INDEX "AttendanceRequestQuery_approvalStatus_idx" ON "AttendanceRequestQuery"("approvalStatus");

-- CreateIndex
CREATE INDEX "AttendanceRequestQuery_attendanceDate_idx" ON "AttendanceRequestQuery"("attendanceDate");

-- CreateIndex
CREATE INDEX "LeaveApplication_employeeId_idx" ON "LeaveApplication"("employeeId");

-- CreateIndex
CREATE INDEX "LeaveApplication_leaveTypeId_idx" ON "LeaveApplication"("leaveTypeId");

-- CreateIndex
CREATE INDEX "LeaveApplication_status_idx" ON "LeaveApplication"("status");

-- CreateIndex
CREATE INDEX "LeaveApplication_fromDate_idx" ON "LeaveApplication"("fromDate");

-- CreateIndex
CREATE INDEX "LeaveApplication_toDate_idx" ON "LeaveApplication"("toDate");

-- CreateIndex
CREATE INDEX "AttendanceExemption_employeeId_idx" ON "AttendanceExemption"("employeeId");

-- CreateIndex
CREATE INDEX "AttendanceExemption_approvalStatus_idx" ON "AttendanceExemption"("approvalStatus");

-- CreateIndex
CREATE INDEX "AttendanceExemption_attendanceDate_idx" ON "AttendanceExemption"("attendanceDate");

-- CreateIndex
CREATE INDEX "WorkingHoursPolicyAssignment_employeeId_idx" ON "WorkingHoursPolicyAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "WorkingHoursPolicyAssignment_workingHoursPolicyId_idx" ON "WorkingHoursPolicyAssignment"("workingHoursPolicyId");

-- CreateIndex
CREATE INDEX "WorkingHoursPolicyAssignment_startDate_idx" ON "WorkingHoursPolicyAssignment"("startDate");

-- CreateIndex
CREATE INDEX "WorkingHoursPolicyAssignment_endDate_idx" ON "WorkingHoursPolicyAssignment"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeId_key" ON "Employee"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_cnicNumber_key" ON "Employee"("cnicNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_officialEmail_key" ON "Employee"("officialEmail");

-- CreateIndex
CREATE INDEX "EmployeeRejoiningHistory_employeeId_idx" ON "EmployeeRejoiningHistory"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeRejoiningHistory_rejoiningDate_idx" ON "EmployeeRejoiningHistory"("rejoiningDate");

-- CreateIndex
CREATE INDEX "EmployeeTransferHistory_employeeId_idx" ON "EmployeeTransferHistory"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeTransferHistory_transferDate_idx" ON "EmployeeTransferHistory"("transferDate");

-- CreateIndex
CREATE INDEX "EmployeeQualification_employeeId_idx" ON "EmployeeQualification"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeEquipment_employeeId_idx" ON "EmployeeEquipment"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeEquipment_status_idx" ON "EmployeeEquipment"("status");

-- CreateIndex
CREATE INDEX "EmployeeEquipment_productId_idx" ON "EmployeeEquipment"("productId");

-- CreateIndex
CREATE INDEX "ExitClearance_employeeId_idx" ON "ExitClearance"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccount_code_key" ON "ChartOfAccount"("code");

-- CreateIndex
CREATE INDEX "ChartOfAccount_parentId_idx" ON "ChartOfAccount"("parentId");

-- CreateIndex
CREATE INDEX "ChartOfAccount_type_idx" ON "ChartOfAccount"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Item_itemId_key" ON "Item"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_sku_key" ON "Item"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "JournalVoucher_jvNo_key" ON "JournalVoucher"("jvNo");

-- CreateIndex
CREATE INDEX "JournalVoucherDetail_journalVoucherId_idx" ON "JournalVoucherDetail"("journalVoucherId");

-- CreateIndex
CREATE INDEX "JournalVoucherDetail_accountId_idx" ON "JournalVoucherDetail"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentVoucher_pvNo_key" ON "PaymentVoucher"("pvNo");

-- CreateIndex
CREATE INDEX "PaymentVoucherDetail_paymentVoucherId_idx" ON "PaymentVoucherDetail"("paymentVoucherId");

-- CreateIndex
CREATE INDEX "PaymentVoucherDetail_accountId_idx" ON "PaymentVoucherDetail"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptVoucher_rvNo_key" ON "ReceiptVoucher"("rvNo");

-- CreateIndex
CREATE INDEX "ReceiptVoucherDetail_receiptVoucherId_idx" ON "ReceiptVoucherDetail"("receiptVoucherId");

-- CreateIndex
CREATE INDEX "ReceiptVoucherDetail_accountId_idx" ON "ReceiptVoucherDetail"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_chartOfAccountId_idx" ON "Supplier"("chartOfAccountId");

-- CreateIndex
CREATE INDEX "Supplier_nature_idx" ON "Supplier"("nature");

-- CreateIndex
CREATE INDEX "Supplier_type_idx" ON "Supplier"("type");

-- CreateIndex
CREATE UNIQUE INDEX "TenantItemSetting_itemId_key" ON "TenantItemSetting"("itemId");

-- CreateIndex
CREATE INDEX "TenantItemSetting_itemId_idx" ON "TenantItemSetting"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "UomConversion_fromUomId_toUomId_key" ON "UomConversion"("fromUomId", "toUomId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_itemId_idx" ON "InventoryTransaction"("itemId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_transactionDate_idx" ON "InventoryTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "InventoryTransaction_documentId_idx" ON "InventoryTransaction"("documentId");

-- CreateIndex
CREATE INDEX "LoanRequest_employeeId_idx" ON "LoanRequest"("employeeId");

-- CreateIndex
CREATE INDEX "LoanRequest_loanTypeId_idx" ON "LoanRequest"("loanTypeId");

-- CreateIndex
CREATE INDEX "LoanRequest_repaymentStartMonthYear_idx" ON "LoanRequest"("repaymentStartMonthYear");

-- CreateIndex
CREATE INDEX "LoanRequest_approvalStatus_idx" ON "LoanRequest"("approvalStatus");

-- CreateIndex
CREATE INDEX "LoanRequest_status_idx" ON "LoanRequest"("status");

-- CreateIndex
CREATE INDEX "LoanRequest_requestedDate_idx" ON "LoanRequest"("requestedDate");

-- CreateIndex
CREATE INDEX "Allowance_employeeId_idx" ON "Allowance"("employeeId");

-- CreateIndex
CREATE INDEX "Allowance_allowanceHeadId_idx" ON "Allowance"("allowanceHeadId");

-- CreateIndex
CREATE INDEX "Allowance_month_year_idx" ON "Allowance"("month", "year");

-- CreateIndex
CREATE INDEX "Allowance_status_idx" ON "Allowance"("status");

-- CreateIndex
CREATE INDEX "Allowance_type_idx" ON "Allowance"("type");

-- CreateIndex
CREATE INDEX "Deduction_employeeId_idx" ON "Deduction"("employeeId");

-- CreateIndex
CREATE INDEX "Deduction_deductionHeadId_idx" ON "Deduction"("deductionHeadId");

-- CreateIndex
CREATE INDEX "Deduction_month_year_idx" ON "Deduction"("month", "year");

-- CreateIndex
CREATE INDEX "Deduction_status_idx" ON "Deduction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Deduction_employeeId_deductionHeadId_month_year_key" ON "Deduction"("employeeId", "deductionHeadId", "month", "year");

-- CreateIndex
CREATE INDEX "AdvanceSalary_employeeId_idx" ON "AdvanceSalary"("employeeId");

-- CreateIndex
CREATE INDEX "AdvanceSalary_deductionMonth_deductionYear_idx" ON "AdvanceSalary"("deductionMonth", "deductionYear");

-- CreateIndex
CREATE INDEX "AdvanceSalary_deductionMonthYear_idx" ON "AdvanceSalary"("deductionMonthYear");

-- CreateIndex
CREATE INDEX "AdvanceSalary_approvalStatus_idx" ON "AdvanceSalary"("approvalStatus");

-- CreateIndex
CREATE INDEX "AdvanceSalary_status_idx" ON "AdvanceSalary"("status");

-- CreateIndex
CREATE INDEX "AdvanceSalary_neededOn_idx" ON "AdvanceSalary"("neededOn");

-- CreateIndex
CREATE INDEX "OvertimeRequest_employeeId_idx" ON "OvertimeRequest"("employeeId");

-- CreateIndex
CREATE INDEX "OvertimeRequest_overtimeType_idx" ON "OvertimeRequest"("overtimeType");

-- CreateIndex
CREATE INDEX "OvertimeRequest_status_idx" ON "OvertimeRequest"("status");

-- CreateIndex
CREATE INDEX "OvertimeRequest_date_idx" ON "OvertimeRequest"("date");

-- CreateIndex
CREATE INDEX "Increment_employeeId_idx" ON "Increment"("employeeId");

-- CreateIndex
CREATE INDEX "Increment_employeeGradeId_idx" ON "Increment"("employeeGradeId");

-- CreateIndex
CREATE INDEX "Increment_designationId_idx" ON "Increment"("designationId");

-- CreateIndex
CREATE INDEX "Increment_incrementType_idx" ON "Increment"("incrementType");

-- CreateIndex
CREATE INDEX "Increment_currentMonth_idx" ON "Increment"("currentMonth");

-- CreateIndex
CREATE INDEX "Increment_status_idx" ON "Increment"("status");

-- CreateIndex
CREATE INDEX "Bonus_employeeId_idx" ON "Bonus"("employeeId");

-- CreateIndex
CREATE INDEX "Bonus_bonusTypeId_idx" ON "Bonus"("bonusTypeId");

-- CreateIndex
CREATE INDEX "Bonus_bonusMonth_bonusYear_idx" ON "Bonus"("bonusMonth", "bonusYear");

-- CreateIndex
CREATE INDEX "Bonus_bonusMonthYear_idx" ON "Bonus"("bonusMonthYear");

-- CreateIndex
CREATE INDEX "Bonus_status_idx" ON "Bonus"("status");

-- CreateIndex
CREATE INDEX "Bonus_paymentMethod_idx" ON "Bonus"("paymentMethod");

-- CreateIndex
CREATE UNIQUE INDEX "Bonus_employeeId_bonusTypeId_bonusMonthYear_key" ON "Bonus"("employeeId", "bonusTypeId", "bonusMonthYear");

-- CreateIndex
CREATE INDEX "LeaveEncashment_employeeId_idx" ON "LeaveEncashment"("employeeId");

-- CreateIndex
CREATE INDEX "LeaveEncashment_paymentMonth_paymentYear_idx" ON "LeaveEncashment"("paymentMonth", "paymentYear");

-- CreateIndex
CREATE INDEX "LeaveEncashment_paymentMonthYear_idx" ON "LeaveEncashment"("paymentMonthYear");

-- CreateIndex
CREATE INDEX "LeaveEncashment_approvalStatus_idx" ON "LeaveEncashment"("approvalStatus");

-- CreateIndex
CREATE INDEX "LeaveEncashment_status_idx" ON "LeaveEncashment"("status");

-- CreateIndex
CREATE INDEX "LeaveEncashment_encashmentDate_idx" ON "LeaveEncashment"("encashmentDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_month_year_key" ON "Payroll"("month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollDetail_payrollId_employeeId_key" ON "PayrollDetail"("payrollId", "employeeId");

-- CreateIndex
CREATE INDEX "PFWithdrawal_employeeId_idx" ON "PFWithdrawal"("employeeId");

-- CreateIndex
CREATE INDEX "PFWithdrawal_month_year_idx" ON "PFWithdrawal"("month", "year");

-- CreateIndex
CREATE INDEX "PFWithdrawal_monthYear_idx" ON "PFWithdrawal"("monthYear");

-- CreateIndex
CREATE INDEX "PFWithdrawal_approvalStatus_idx" ON "PFWithdrawal"("approvalStatus");

-- CreateIndex
CREATE INDEX "PFWithdrawal_status_idx" ON "PFWithdrawal"("status");

-- CreateIndex
CREATE INDEX "PFWithdrawal_withdrawalDate_idx" ON "PFWithdrawal"("withdrawalDate");

-- CreateIndex
CREATE INDEX "PayrollApprovalRequest_requestType_idx" ON "PayrollApprovalRequest"("requestType");

-- CreateIndex
CREATE INDEX "PayrollApprovalRequest_employeeId_idx" ON "PayrollApprovalRequest"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollApprovalRequest_status_idx" ON "PayrollApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "PayrollApprovalLevel_approvalRequestId_idx" ON "PayrollApprovalLevel"("approvalRequestId");

-- CreateIndex
CREATE INDEX "PayrollApprovalLevel_level_idx" ON "PayrollApprovalLevel"("level");

-- CreateIndex
CREATE INDEX "PayrollApprovalLevel_status_idx" ON "PayrollApprovalLevel"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollApprovalLevel_approvalRequestId_level_key" ON "PayrollApprovalLevel"("approvalRequestId", "level");

-- CreateIndex
CREATE INDEX "PayrollApprovalHistory_approvalRequestId_idx" ON "PayrollApprovalHistory"("approvalRequestId");

-- CreateIndex
CREATE INDEX "PayrollApprovalHistory_performedById_idx" ON "PayrollApprovalHistory"("performedById");

-- CreateIndex
CREATE INDEX "PayrollApprovalHistory_status_idx" ON "PayrollApprovalHistory"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Rebate_employeeId_rebateNatureId_monthYear_key" ON "Rebate"("employeeId", "rebateNatureId", "monthYear");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_pr_number_key" ON "purchase_requisitions"("pr_number");

-- CreateIndex
CREATE UNIQUE INDEX "rfqs_rfq_number_key" ON "rfqs"("rfq_number");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_vendors_rfq_id_vendor_id_key" ON "rfq_vendors"("rfq_id", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_quotations_rfq_id_vendor_id_key" ON "vendor_quotations"("rfq_id", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "RequestForwardingConfiguration_requestType_key" ON "RequestForwardingConfiguration"("requestType");

-- CreateIndex
CREATE INDEX "RequestForwardingConfiguration_requestType_idx" ON "RequestForwardingConfiguration"("requestType");

-- CreateIndex
CREATE INDEX "RequestForwardingConfiguration_status_idx" ON "RequestForwardingConfiguration"("status");

-- CreateIndex
CREATE INDEX "RequestForwardingApprovalLevel_configurationId_idx" ON "RequestForwardingApprovalLevel"("configurationId");

-- CreateIndex
CREATE INDEX "RequestForwardingApprovalLevel_level_idx" ON "RequestForwardingApprovalLevel"("level");

-- CreateIndex
CREATE INDEX "RequestForwardingApprovalLevel_approverType_idx" ON "RequestForwardingApprovalLevel"("approverType");

-- CreateIndex
CREATE INDEX "InventoryItem_itemId_idx" ON "InventoryItem"("itemId");

-- CreateIndex
CREATE INDEX "InventoryItem_warehouseId_idx" ON "InventoryItem"("warehouseId");

-- CreateIndex
CREATE INDEX "InventoryItem_batchNumber_idx" ON "InventoryItem"("batchNumber");

-- CreateIndex
CREATE INDEX "InventoryItem_expiryDate_idx" ON "InventoryItem"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_locationId_itemId_batchNumber_serialNumber_st_key" ON "InventoryItem"("locationId", "itemId", "batchNumber", "serialNumber", "status");

-- CreateIndex
CREATE INDEX "StockReserve_itemId_warehouseId_idx" ON "StockReserve"("itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockReserve_referenceId_idx" ON "StockReserve"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_movementNo_key" ON "StockMovement"("movementNo");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_idx" ON "StockMovement"("itemId");

-- CreateIndex
CREATE INDEX "StockMovement_fromLocationId_idx" ON "StockMovement"("fromLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_toLocationId_idx" ON "StockMovement"("toLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_movementDate_idx" ON "StockMovement"("movementDate");

-- CreateIndex
CREATE INDEX "StockMovement_referenceId_idx" ON "StockMovement"("referenceId");

-- CreateIndex
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");

-- CreateIndex
CREATE UNIQUE INDEX "TransferRequest_requestNo_key" ON "TransferRequest"("requestNo");

-- CreateIndex
CREATE UNIQUE INDEX "TransferRequestItem_transferRequestId_itemId_batchNumber_key" ON "TransferRequestItem"("transferRequestId", "itemId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE INDEX "Warehouse_companyId_idx" ON "Warehouse"("companyId");

-- CreateIndex
CREATE INDEX "Warehouse_type_idx" ON "Warehouse"("type");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_barcode_key" ON "WarehouseLocation"("barcode");

-- CreateIndex
CREATE INDEX "WarehouseLocation_parentId_idx" ON "WarehouseLocation"("parentId");

-- CreateIndex
CREATE INDEX "WarehouseLocation_barcode_idx" ON "WarehouseLocation"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_warehouseId_code_key" ON "WarehouseLocation"("warehouseId", "code");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRequestQuery" ADD CONSTRAINT "AttendanceRequestQuery_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceExemption" ADD CONSTRAINT "AttendanceExemption_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHoursPolicyAssignment" ADD CONSTRAINT "WorkingHoursPolicyAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRejoiningHistory" ADD CONSTRAINT "EmployeeRejoiningHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransferHistory" ADD CONSTRAINT "EmployeeTransferHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeQualification" ADD CONSTRAINT "EmployeeQualification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEquipment" ADD CONSTRAINT "EmployeeEquipment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitClearance" ADD CONSTRAINT "ExitClearance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartOfAccount" ADD CONSTRAINT "ChartOfAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalVoucherDetail" ADD CONSTRAINT "JournalVoucherDetail_journalVoucherId_fkey" FOREIGN KEY ("journalVoucherId") REFERENCES "JournalVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalVoucherDetail" ADD CONSTRAINT "JournalVoucherDetail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucherDetail" ADD CONSTRAINT "PaymentVoucherDetail_paymentVoucherId_fkey" FOREIGN KEY ("paymentVoucherId") REFERENCES "PaymentVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucherDetail" ADD CONSTRAINT "PaymentVoucherDetail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptVoucher" ADD CONSTRAINT "ReceiptVoucher_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptVoucherDetail" ADD CONSTRAINT "ReceiptVoucherDetail_receiptVoucherId_fkey" FOREIGN KEY ("receiptVoucherId") REFERENCES "ReceiptVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptVoucherDetail" ADD CONSTRAINT "ReceiptVoucherDetail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_chartOfAccountId_fkey" FOREIGN KEY ("chartOfAccountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allowance" ADD CONSTRAINT "Allowance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceSalary" ADD CONSTRAINT "AdvanceSalary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Increment" ADD CONSTRAINT "Increment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEncashment" ADD CONSTRAINT "LeaveEncashment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollDetail" ADD CONSTRAINT "PayrollDetail_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollDetail" ADD CONSTRAINT "PayrollDetail_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PFWithdrawal" ADD CONSTRAINT "PFWithdrawal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollApprovalRequest" ADD CONSTRAINT "PayrollApprovalRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollApprovalRequest" ADD CONSTRAINT "PayrollApprovalRequest_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "RequestForwardingConfiguration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollApprovalLevel" ADD CONSTRAINT "PayrollApprovalLevel_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "PayrollApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollApprovalLevel" ADD CONSTRAINT "PayrollApprovalLevel_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollApprovalHistory" ADD CONSTRAINT "PayrollApprovalHistory_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "PayrollApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rebate" ADD CONSTRAINT "Rebate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_purchase_requisition_id_fkey" FOREIGN KEY ("purchase_requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_purchase_requisition_id_fkey" FOREIGN KEY ("purchase_requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_vendors" ADD CONSTRAINT "rfq_vendors_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_vendors" ADD CONSTRAINT "rfq_vendors_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_quotation_items" ADD CONSTRAINT "vendor_quotation_items_vendor_quotation_id_fkey" FOREIGN KEY ("vendor_quotation_id") REFERENCES "vendor_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestForwardingApprovalLevel" ADD CONSTRAINT "RequestForwardingApprovalLevel_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "RequestForwardingConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestForwardingApprovalLevel" ADD CONSTRAINT "RequestForwardingApprovalLevel_specificEmployeeId_fkey" FOREIGN KEY ("specificEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRequestItem" ADD CONSTRAINT "TransferRequestItem_transferRequestId_fkey" FOREIGN KEY ("transferRequestId") REFERENCES "TransferRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
