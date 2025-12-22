export class CreateApprovalLevelDto {
  level: number;
  approverType: string; // "specific-employee" | "department-head" | "sub-department-head" | "reporting-manager"
  departmentHeadMode?: string; // "auto" | "specific" (only for department-head and sub-department-head)
  specificEmployeeId?: string | null;
  departmentId?: string | null;
  subDepartmentId?: string | null;
}

export class CreateRequestForwardingDto {
  requestType: string; // "exemption" | "attendance" | "advance-salary" | "loan"
  approvalFlow: string; // "auto-approved" | "multi-level"
  levels?: CreateApprovalLevelDto[];
}
