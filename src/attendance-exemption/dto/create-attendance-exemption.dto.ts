export class CreateAttendanceExemptionDto {
  employeeId?: string | null;
  employeeName?: string | null;
  department?: string | null;
  subDepartment?: string | null;
  attendanceDate: string; // ISO date string
  flagType: string; // Late, Absent, Early Leave, Missing Check-in, Missing Check-out, Other
  exemptionType: string; // Medical Emergency, Family Emergency, Official Duty, Approved Leave, System Error, Other
  reason: string;
  approvalStatus?: string; // default "pending"
}

