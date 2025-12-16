export class CreateLeaveApplicationDto {
  employeeId: string
  leaveTypeId: string
  dayType: 'fullDay' | 'halfDay' | 'shortLeave'
  fromDate: string
  toDate: string
  reasonForLeave: string
  addressWhileOnLeave: string
}

