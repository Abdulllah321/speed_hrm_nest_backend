import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export const MASTER_DELETE_BLOCKED_MESSAGE =
  'Cannot delete this record because it is linked with existing active data.';

export type MasterDeleteEntity =
  | 'allocation'
  | 'department'
  | 'subDepartment'
  | 'designation'
  | 'employeeGrade'
  | 'employeeStatus'
  | 'maritalStatus'
  | 'city'
  | 'location'
  | 'leavesPolicy'
  | 'workingHoursPolicy'
  | 'leaveType'
  | 'institute'
  | 'qualification'
  | 'equipment'
  | 'brand'
  | 'division'
  | 'category'
  | 'itemClass'
  | 'itemSubclass'
  | 'gender'
  | 'color'
  | 'size'
  | 'silhouette'
  | 'channelClass'
  | 'segment'
  | 'season'
  | 'hsCode'
  | 'pos'
  | 'allowanceHead'
  | 'deductionHead'
  | 'bonusType'
  | 'loanType'
  | 'rebateNature'
  | 'socialSecurityInstitution'
  | 'socialSecurityEmployerRegistration'
  | 'socialSecurityEmployeeRegistration';

/** Stateless guard — pass request-scoped PrismaService from the calling service. */
@Injectable()
export class MasterDeleteGuardService {
  /** Returns the blocked message when delete must be prevented, otherwise null. */
  async checkBlocked(
    prisma: PrismaService,
    entity: MasterDeleteEntity,
    id: string,
  ): Promise<string | null> {
    const linked = await this.hasActiveReferences(prisma, entity, id);
    return linked ? MASTER_DELETE_BLOCKED_MESSAGE : null;
  }

  /** Throws BadRequestException when any id is linked to active data. */
  async assertCanDelete(
    prisma: PrismaService,
    entity: MasterDeleteEntity,
    ids: string | string[],
  ): Promise<void> {
    const idList = Array.isArray(ids) ? ids : [ids];
    for (const id of idList) {
      if (await this.hasActiveReferences(prisma, entity, id)) {
        throw new BadRequestException(MASTER_DELETE_BLOCKED_MESSAGE);
      }
    }
  }

  private async hasActiveReferences(
    prisma: PrismaService,
    entity: MasterDeleteEntity,
    id: string,
  ): Promise<boolean> {
    switch (entity) {
      case 'allocation':
        return this.anyCount([
          prisma.department.count({
            where: { allocationId: id, isDeleted: false },
          }),
          prisma.employee.count({ where: { allocationId: id } }),
        ]);

      case 'department':
        return this.anyCount([
          prisma.subDepartment.count({
            where: { departmentId: id, isDeleted: false },
          }),
          prisma.employee.count({ where: { departmentId: id } }),
          prisma.employeeRejoiningHistory.count({
            where: {
              OR: [{ previousDepartmentId: id }, { newDepartmentId: id }],
            },
          }),
          prisma.taskProject.count({ where: { departmentId: id } }),
        ]);

      case 'subDepartment':
        return this.anyCount([
          prisma.employee.count({ where: { subDepartmentId: id } }),
        ]);

      case 'designation':
        return this.anyCount([
          prisma.employee.count({ where: { designationId: id } }),
          prisma.employeeRejoiningHistory.count({
            where: {
              OR: [
                { previousDesignationId: id },
                { newDesignationId: id },
              ],
            },
          }),
        ]);

      case 'employeeGrade':
        return this.anyCount([
          prisma.employee.count({ where: { employeeGradeId: id } }),
        ]);

      case 'employeeStatus':
        return this.anyCount([
          prisma.employee.count({ where: { employmentStatusId: id } }),
        ]);

      case 'maritalStatus':
        return this.anyCount([
          prisma.employee.count({ where: { maritalStatusId: id } }),
        ]);

      case 'city':
        return this.anyCount([
          prisma.employee.count({ where: { cityId: id } }),
          prisma.employeeQualification.count({ where: { cityId: id } }),
          prisma.employeeTransferHistory.count({
            where: {
              OR: [{ previousCityId: id }, { newCityId: id }],
            },
          }),
        ]);

      case 'location':
        return this.anyCount([
          prisma.employee.count({ where: { locationId: id } }),
          prisma.pos.count({ where: { locationId: id, isDeleted: false } }),
          prisma.inventoryItem.count({ where: { locationId: id } }),
          prisma.employeeTransferHistory.count({
            where: {
              OR: [{ previousLocationId: id }, { newLocationId: id }],
            },
          }),
        ]);

      case 'leavesPolicy':
        return this.anyCount([
          prisma.employee.count({ where: { leavesPolicyId: id } }),
        ]);

      case 'workingHoursPolicy':
        return this.anyCount([
          prisma.employee.count({ where: { workingHoursPolicyId: id } }),
          prisma.workingHoursPolicyAssignment.count({
            where: { workingHoursPolicyId: id },
          }),
        ]);

      case 'leaveType':
        return this.anyCount([
          prisma.leavesPolicyLeaveType.count({
            where: { leaveTypeId: id, isDeleted: false },
          }),
          prisma.leaveApplication.count({ where: { leaveTypeId: id } }),
        ]);

      case 'institute':
        return this.anyCount([
          prisma.employeeQualification.count({ where: { instituteId: id } }),
        ]);

      case 'qualification':
        return this.anyCount([
          prisma.employeeQualification.count({
            where: { qualificationId: id },
          }),
        ]);

      case 'equipment':
        return this.anyCount([
          prisma.employeeEquipment.count({ where: { equipmentId: id } }),
        ]);

      case 'brand':
        return this.anyCount([
          prisma.division.count({
            where: { brandId: id, isDeleted: false },
          }),
          prisma.item.count({ where: { brandId: id } }),
        ]);

      case 'division':
        return this.anyCount([
          prisma.item.count({ where: { divisionId: id } }),
        ]);

      case 'category':
        return this.anyCount([
          prisma.category.count({
            where: { parentId: id, isDeleted: false },
          }),
          prisma.item.count({
            where: {
              OR: [{ categoryId: id }, { subCategoryId: id }],
            },
          }),
        ]);

      case 'itemClass':
        return this.anyCount([
          prisma.itemSubclass.count({
            where: { itemClassId: id, isDeleted: false },
          }),
          prisma.item.count({ where: { itemClassId: id } }),
        ]);

      case 'itemSubclass':
        return this.anyCount([
          prisma.item.count({ where: { itemSubclassId: id } }),
        ]);

      case 'gender':
        return this.anyCount([
          prisma.item.count({ where: { genderId: id } }),
        ]);

      case 'color':
        return this.anyCount([
          prisma.item.count({ where: { colorId: id } }),
        ]);

      case 'size':
        return this.anyCount([
          prisma.item.count({ where: { sizeId: id } }),
        ]);

      case 'silhouette':
        return this.anyCount([
          prisma.item.count({ where: { silhouetteId: id } }),
        ]);

      case 'channelClass':
        return this.anyCount([
          prisma.item.count({ where: { channelClassId: id } }),
        ]);

      case 'segment':
        return this.anyCount([
          prisma.item.count({ where: { segmentId: id } }),
        ]);

      case 'season':
        return this.anyCount([
          prisma.item.count({ where: { seasonId: id } }),
        ]);

      case 'hsCode':
        return this.anyCount([
          prisma.item.count({ where: { hsCodeId: id } }),
        ]);

      case 'pos':
        return this.anyCount([
          prisma.posSession.count({ where: { posId: id } }),
        ]);

      case 'allowanceHead':
        return this.anyCount([
          prisma.allowance.count({ where: { allowanceHeadId: id } }),
        ]);

      case 'deductionHead':
        return this.anyCount([
          prisma.deduction.count({ where: { deductionHeadId: id } }),
        ]);

      case 'bonusType':
        return this.anyCount([
          prisma.bonus.count({ where: { bonusTypeId: id } }),
        ]);

      case 'loanType':
        return this.anyCount([
          prisma.loanRequest.count({ where: { loanTypeId: id } }),
        ]);

      case 'rebateNature':
        return this.anyCount([
          prisma.rebate.count({ where: { rebateNatureId: id } }),
        ]);

      case 'socialSecurityInstitution':
        return this.anyCount([
          prisma.employee.count({
            where: { socialSecurityInstitutionId: id },
          }),
          prisma.socialSecurityEmployerRegistration.count({
            where: { institutionId: id, isDeleted: false },
          }),
          prisma.socialSecurityEmployeeRegistration.count({
            where: { institutionId: id, isDeleted: false },
          }),
          prisma.socialSecurityContribution.count({
            where: { institutionId: id, isDeleted: false },
          }),
        ]);

      case 'socialSecurityEmployerRegistration':
        return this.anyCount([
          prisma.socialSecurityEmployeeRegistration.count({
            where: { employerRegistrationId: id, isDeleted: false },
          }),
          prisma.socialSecurityContribution.count({
            where: { employerRegistrationId: id, isDeleted: false },
          }),
        ]);

      case 'socialSecurityEmployeeRegistration':
        return this.anyCount([
          prisma.socialSecurityContribution.count({
            where: { employeeRegistrationId: id, isDeleted: false },
          }),
        ]);

      default:
        return false;
    }
  }

  private async anyCount(countPromises: Promise<number>[]): Promise<boolean> {
    const counts = await Promise.all(countPromises);
    return counts.some((c) => c > 0);
  }
}
