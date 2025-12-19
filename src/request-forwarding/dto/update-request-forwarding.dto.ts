import { CreateApprovalLevelDto } from './create-request-forwarding.dto';

export class UpdateApprovalLevelDto {
  level: number;
  approverType: string;
  departmentHeadMode?: string | null;
  specificEmployeeId?: string | null;
  departmentId?: string | null;
  subDepartmentId?: string | null;
}

export class UpdateRequestForwardingDto {
  approvalFlow?: string;
  status?: string;
  levels?: UpdateApprovalLevelDto[];
}
