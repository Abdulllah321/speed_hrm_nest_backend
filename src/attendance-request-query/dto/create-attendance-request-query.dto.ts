export class CreateAttendanceRequestQueryDto {
  employeeId?: string | null;
  employeeName?: string | null;
  department?: string | null;
  subDepartment?: string | null;
  attendanceDate: string; // ISO date string
  clockInTimeRequest?: string | null;
  clockOutTimeRequest?: string | null;
  breakIn?: string | null;
  breakOut?: string | null;
  query: string;
  approvalStatus?: string; // default "pending"
}

