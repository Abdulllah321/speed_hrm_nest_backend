/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EmployeeService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async list() {
    const employees = await this.prisma.employee.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        qualifications: true,
        department: {
          select: {
            id: true,
            name: true,
            subDepartments: true,
          },
        },
        subDepartment: {
          select: {
            id: true,
            name: true,
          },
        },
        designation: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Map to include names for compatibility
    type EmployeeWithRelations = Prisma.EmployeeGetPayload<{
      include: {
        qualifications: true;
        department: { select: { id: true; name: true; subDepartments: true } };
        subDepartment: { select: { id: true; name: true } };
        designation: { select: { id: true; name: true } };
      };
    }>;

    const mappedEmployees = employees.map((emp: EmployeeWithRelations) => ({
      ...emp,
      department: emp.department?.name || emp.departmentId,
      subDepartment: emp.subDepartment?.name || emp.subDepartmentId,
      designation: emp.designation?.name || emp.designationId,
    }));

    return { status: true, data: mappedEmployees };
  }

  // Lightweight method to fetch only required fields for attendance management
  async listForAttendance(filters?: {
    departmentId?: string;
    subDepartmentId?: string;
  }) {
    const where: Prisma.EmployeeWhereInput = {};

    if (filters?.departmentId) {
      where.departmentId = filters.departmentId;
    }

    if (filters?.subDepartmentId) {
      where.subDepartmentId = filters.subDepartmentId;
    }

    const employees = await this.prisma.employee.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        employeeName: true,
        departmentId: true,
        subDepartmentId: true,
        workingHoursPolicyId: true,
        department: {
          select: {
            id: true,
            name: true,
          },
        },
        subDepartment: {
          select: {
            id: true,
            name: true,
          },
        },
        workingHoursPolicy: {
          select: {
            id: true,
            name: true,
            startWorkingHours: true,
            endWorkingHours: true,
          },
        },
      },
      orderBy: { employeeName: 'asc' },
    });

    return { status: true, data: employees };
  }

  // Minimal fields for dropdowns/selects
  async listForDropdown() {
    const employees = await this.prisma.employee.findMany({
      select: {
        id: true,
        employeeId: true,
        employeeName: true,
        departmentId: true,
        subDepartmentId: true,
        providentFund: true,
        department: {
          select: { name: true },
        },
        subDepartment: {
          select: { name: true },
        },
        designation: {
          select: { name: true },
        },
      },
      orderBy: { employeeName: 'asc' },
    });

    return {
      status: true,
      data: employees.map((emp) => ({
        id: emp.id,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        departmentId: emp.departmentId,
        subDepartmentId: emp.subDepartmentId,
        departmentName: emp.department?.name || null,
        subDepartmentName: emp.subDepartment?.name || null,
        designationName: emp.designation?.name || null,
        providentFund: emp.providentFund,
      })),
    };
  }

  /**
   * Get employee by ID
   * Returns CURRENT employee details (after any rejoins)
   * To see historical data, use getRejoiningHistory() or getHistoricalState()
   */
  async get(id: string, includeHistory: boolean = false) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            avatar: true,
          },
        },
        department: {
          select: {
            id: true,
            name: true,
            subDepartments: true,
          },
        },
        subDepartment: {
          select: {
            id: true,
            name: true,
          },
        },
        employeeGrade: {
          select: {
            id: true,
            grade: true,
          },
        },
        designation: {
          select: {
            id: true,
            name: true,
          },
        },
        maritalStatus: {
          select: {
            id: true,
            name: true,
          },
        },
        employmentStatus: {
          select: {
            id: true,
            status: true,
          },
        },
        country: {
          select: {
            id: true,
            name: true,
          },
        },
        state: {
          select: {
            id: true,
            name: true,
          },
        },
        city: {
          select: {
            id: true,
            name: true,
          },
        },
        workingHoursPolicy: {
          select: {
            id: true,
            name: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
          },
        },
        leavesPolicy: {
          select: {
            id: true,
            name: true,
          },
        },
        allocation: {
          select: {
            id: true,
            name: true,
          },
        },
        qualifications: {
          include: {
            qualification: {
              select: {
                id: true,
                name: true,
              },
            },
            institute: {
              select: {
                id: true,
                name: true,
              },
            },
            state: {
              select: {
                id: true,
                name: true,
              },
            },
            city: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        equipmentAssignments: {
          include: {
            equipment: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        // Include rejoining history summary if requested
        ...(includeHistory
          ? {
            rejoiningHistory: {
              select: {
                id: true,
                rejoiningDate: true,
                previousEmployeeId: true,
                newEmployeeId: true,
                remarks: true,
                createdAt: true,
              },
              orderBy: {
                rejoiningDate: 'desc',
              },
              take: 1, // Latest rejoin only
            },
          }
          : {}),
      },
    });
    if (!employee) return { status: false, message: 'Employee not found' };

    // Type assertion since we know the query includes these relations
    const emp = employee as typeof employee & {
      user?: { id: string; avatar: string | null } | null;
      department?: { id: string; name: string } | null;
      subDepartment?: { id: string; name: string } | null;
      employeeGrade?: { id: string; grade: string } | null;
      designation?: { id: string; name: string } | null;
      maritalStatus?: { id: string; name: string } | null;
      employmentStatus?: { id: string; status: string } | null;
      country?: { id: string; name: string } | null;
      state?: { id: string; name: string } | null;
      city?: { id: string; name: string } | null;
      workingHoursPolicy?: { id: string; name: string } | null;
      location?: { id: string; name: string } | null;
      leavesPolicy?: { id: string; name: string } | null;
      allocation?: { id: string; name: string } | null;
      rejoiningHistory?: Array<{
        id: string;
        rejoiningDate: Date;
        previousEmployeeId: string;
        newEmployeeId: string;
        remarks: string | null;
        createdAt: Date;
      }>;
    };

    // Map relations to IDs for form compatibility, while keeping relation objects
    const mappedEmployee = {
      ...emp,
      department: emp.department?.id || emp.departmentId,
      subDepartment: emp.subDepartment?.id || emp.subDepartmentId || null,
      employeeGrade: emp.employeeGrade?.id || emp.employeeGradeId,
      designation: emp.designation?.id || emp.designationId,
      maritalStatus: emp.maritalStatus?.id || emp.maritalStatusId,
      employmentStatus: emp.employmentStatus?.id || emp.employmentStatusId,
      country: emp.country?.id || emp.countryId,
      state: emp.state?.id || emp.stateId,
      province: emp.state?.id || emp.stateId, // Alias for compatibility
      city: emp.city?.id || emp.cityId,
      workingHoursPolicy:
        emp.workingHoursPolicy?.id || emp.workingHoursPolicyId,
      location: emp.location?.id || emp.locationId,
      leavesPolicy: emp.leavesPolicy?.id || emp.leavesPolicyId,
      allocation: emp.allocation?.id || emp.allocationId || null,
      // Avatar from user table
      avatarUrl: emp.user?.avatar || null,
      // EOBI Document URL
      eobiDocumentUrl: emp.eobiDocumentUrl || null,
      // Document URLs (JSON field)
      documentUrls: emp.documentUrls || null,
      // Explicitly preserve address fields
      currentAddress: emp.currentAddress ?? null,
      permanentAddress: emp.permanentAddress ?? null,
      // Add name fields for frontend display
      departmentName: emp.department?.name || null,
      subDepartmentName: emp.subDepartment?.name || null,
      designationName: emp.designation?.name || null,
      employeeGradeName: emp.employeeGrade?.grade || null,
      maritalStatusName: emp.maritalStatus?.name || null,
      employmentStatusName: emp.employmentStatus?.status || null,
      countryName: emp.country?.name || null,
      provinceName: emp.state?.name || null,
      cityName: emp.city?.name || null,
      workingHoursPolicyName: emp.workingHoursPolicy?.name || null,
      locationName: emp.location?.name || null,
      leavesPolicyName: emp.leavesPolicy?.name || null,
      // Keep relation objects for display purposes
      departmentRelation: emp.department,
      subDepartmentRelation: emp.subDepartment,
      employeeGradeRelation: emp.employeeGrade,
      designationRelation: emp.designation,
      maritalStatusRelation: emp.maritalStatus,
      employmentStatusRelation: emp.employmentStatus,
      countryRelation: emp.country,
      stateRelation: emp.state,
      cityRelation: emp.city,
      workingHoursPolicyRelation: emp.workingHoursPolicy,
      locationRelation: emp.location,
      leavesPolicyRelation: emp.leavesPolicy,
      allocationRelation: emp.allocation,
      // Add rejoining context if requested
      ...(includeHistory &&
        emp.rejoiningHistory &&
        emp.rejoiningHistory.length > 0
        ? {
          lastRejoinInfo: {
            date: emp.rejoiningHistory[0].rejoiningDate,
            remarks: emp.rejoiningHistory[0].remarks,
          },
          hasRejoinHistory: emp.isRejoined,
          rejoinCount: emp.rejoinCount,
        }
        : {}),
    };

    return { status: true, data: mappedEmployee };
  }

  /**
   * Get historical state of employee at a specific point in time
   * Useful for seeing what the employee looked like BEFORE a rejoin
   * @param employeeId - The employee's UUID (not employeeId field)
   * @param beforeDate - Get state before this date (optional, defaults to current time)
   */
  async getHistoricalState(employeeId: string, beforeDate?: Date) {
    try {
      const targetDate = beforeDate || new Date();

      // Get the most recent rejoining history entry before the target date
      const historyEntry = await this.prisma.employeeRejoiningHistory.findFirst(
        {
          where: {
            employeeId: employeeId,
            rejoiningDate: {
              lte: targetDate,
            },
          },
          orderBy: {
            rejoiningDate: 'desc',
          },
        },
      );

      if (!historyEntry) {
        // No rejoin history, return current state
        return this.get(employeeId);
      }

      // Type assertion to access JSON fields that may not be in Prisma types yet
      const historyEntryWithJson = historyEntry as typeof historyEntry & {
        previousValues?: Record<string, unknown>;
        newValues?: Record<string, unknown>;
        changedFields?: string[];
      };

      if (!historyEntryWithJson.previousValues) {
        // No previous values stored, return current state
        return this.get(employeeId);
      }

      // Return the previous values (state before rejoin)
      return {
        status: true,
        data: {
          ...(historyEntryWithJson.previousValues as Record<string, unknown>),
          _isHistorical: true,
          _historicalDate: historyEntry.previousExitDate,
          _rejoinDate: historyEntry.rejoiningDate,
        },
        message: `Historical state before rejoin on ${historyEntry.rejoiningDate.toISOString()}`,
      };
    } catch (error: unknown) {
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to get historical state',
      };
    }
  }

  async create(
    body: any,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Helper function to check if string is UUID
      const isUUID = (str: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          str,
        );

      // Helper function to safely get string value from body
      const getBodyString = (key: string): string => {
        const value = (body as Record<string, unknown>)[key];
        if (typeof value === 'string') {
          return value;
        }
        if (value === null || value === undefined) {
          return '';
        }
        // For primitives (number, boolean, etc.), convert to string
        if (
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          typeof value === 'bigint'
        ) {
          return String(value);
        }
        // For objects/arrays, return empty string to avoid '[object Object]'
        return '';
      };

      // Validate required foreign key fields
      if (!(body as { department?: unknown }).department) {
        throw new Error('Department is required');
      }
      if (!(body as { employeeGrade?: unknown }).employeeGrade) {
        throw new Error('Employee Grade is required');
      }
      if (!(body as { designation?: unknown }).designation) {
        throw new Error('Designation is required');
      }
      // Marital Status is now optional
      // Employment Status is now optional
      if (!(body as { country?: unknown }).country) {
        throw new Error('Country is required');
      }
      if (!(body as { state?: unknown }).state) {
        throw new Error('State is required');
      }
      if (!(body as { city?: unknown }).city) {
        throw new Error('City is required');
      }
      if (!(body as { workingHoursPolicy?: unknown }).workingHoursPolicy) {
        throw new Error('Working Hours Policy is required');
      }
      if (!(body as { leavesPolicy?: unknown }).leavesPolicy) {
        throw new Error('Leaves Policy is required');
      }
      if (!(body as { allocation?: unknown }).allocation) {
        throw new Error('Allocation is required');
      }

      // Resolve department (handle both ID and name)
      const departmentValue = String(
        (body as { department?: unknown }).department,
      );
      let resolvedDepartment: string;
      if (!isUUID(departmentValue)) {
        resolvedDepartment = await this.findOrCreateDepartment(
          departmentValue,
          ctx,
        );
      } else {
        resolvedDepartment = departmentValue;
      }

      // Resolve sub-department if provided (handle both ID and name)
      const subDepartmentValue = getBodyString('subDepartment');
      let resolvedSubDepartment: string | null = null;
      if (subDepartmentValue && !isUUID(subDepartmentValue)) {
        resolvedSubDepartment = await this.findOrCreateSubDepartment(
          subDepartmentValue,
          resolvedDepartment,
          ctx,
        );
      } else if (subDepartmentValue) {
        resolvedSubDepartment = subDepartmentValue;
      }

      // Resolve designation (handle both ID and name)
      const designationValue = getBodyString('designation');
      let resolvedDesignation: string;
      if (!isUUID(designationValue)) {
        resolvedDesignation = await this.findOrCreateDesignation(
          designationValue,
          ctx,
        );
      } else {
        resolvedDesignation = designationValue;
      }

      // Resolve employee grade (handle both ID and name)
      const employeeGradeValue = getBodyString('employeeGrade');
      let resolvedEmployeeGrade: string;
      if (!isUUID(employeeGradeValue)) {
        resolvedEmployeeGrade = await this.findOrCreateEmployeeGrade(
          employeeGradeValue,
          ctx,
        );
      } else {
        resolvedEmployeeGrade = employeeGradeValue;
      }

      // Resolve marital status (handle both ID and name) - optional
      const maritalStatusValue = getBodyString('maritalStatus');
      let resolvedMaritalStatus: string | null = null;
      if (maritalStatusValue) {
        if (!isUUID(maritalStatusValue)) {
          resolvedMaritalStatus = await this.findOrCreateMaritalStatus(
            maritalStatusValue,
            ctx,
          );
        } else {
          resolvedMaritalStatus = maritalStatusValue;
        }
      }

      // Resolve employment status (handle both ID and name)
      const employmentStatusValue = getBodyString('employmentStatus');
      let resolvedEmploymentStatus: string | null = null;
      if (employmentStatusValue) {
        if (!isUUID(employmentStatusValue)) {
          resolvedEmploymentStatus = await this.findOrCreateEmploymentStatus(
            employmentStatusValue,
            ctx,
          );
        } else {
          resolvedEmploymentStatus = employmentStatusValue;
        }
      }

      // Resolve location if provided (handle both ID and name)
      const locationValue = getBodyString('location');
      let resolvedLocation: string | null = null;
      if (locationValue && !isUUID(locationValue)) {
        resolvedLocation = await this.findOrCreateLocation(locationValue, ctx);
      } else if (locationValue) {
        resolvedLocation = locationValue;
      }

      // Resolve working hours policy (handle both ID and name)
      const workingHoursPolicyValue = getBodyString('workingHoursPolicy');
      let resolvedWorkingHoursPolicy: string;
      if (!isUUID(workingHoursPolicyValue)) {
        resolvedWorkingHoursPolicy = await this.findOrCreateWorkingHoursPolicy(
          workingHoursPolicyValue,
          ctx,
        );
      } else {
        resolvedWorkingHoursPolicy = workingHoursPolicyValue;
      }

      // Resolve leaves policy (handle both ID and name)
      const leavesPolicyValue = getBodyString('leavesPolicy');
      let resolvedLeavesPolicy: string;
      if (!isUUID(leavesPolicyValue)) {
        resolvedLeavesPolicy = await this.findOrCreateLeavesPolicy(
          leavesPolicyValue,
          ctx,
        );
      } else {
        resolvedLeavesPolicy = leavesPolicyValue;
      }

      // Resolve allocation (handle both ID and name) - optional
      const allocationValue = getBodyString('allocation');
      let resolvedAllocation: string | null = null;
      if (allocationValue) {
        if (!isUUID(allocationValue)) {
          resolvedAllocation = await this.findOrCreateAllocation(
            allocationValue,
            ctx,
          );
        } else {
          resolvedAllocation = allocationValue;
        }
      }

      // Resolve country, state, city - handle both IDs and names
      const countryValue = getBodyString('country');
      const stateValue = getBodyString('state');
      const cityValue = getBodyString('city');
      let countryId: string = countryValue;
      let stateId: string = stateValue;
      let cityId: string = cityValue;

      if (!isUUID(countryValue)) {
        // It's a name, resolve to ID
        countryId = (await this.findCountryByName(countryValue)) || '';
        if (!countryId) {
          throw new Error(`Country not found: ${countryValue}`);
        }
      } else {
        // Verify the UUID exists
        const countryExists = await this.prisma.country.findUnique({
          where: { id: countryValue },
        });
        if (!countryExists) {
          throw new Error(
            `Country with ID ${countryValue} does not exist in database`,
          );
        }
      }

      if (!isUUID(stateValue)) {
        // It's a name, resolve to ID
        stateId = (await this.findStateByName(stateValue, countryId)) || '';
        if (!stateId) {
          throw new Error(`State not found: ${stateValue}`);
        }
      } else {
        // Verify the UUID exists
        const stateExists = await this.prisma.state.findUnique({
          where: { id: stateValue },
        });
        if (!stateExists) {
          throw new Error(
            `State with ID ${stateValue} does not exist in database`,
          );
        }
      }

      if (!isUUID(cityValue)) {
        // It's a name, resolve to ID
        cityId = (await this.findCityByName(cityValue, stateId)) || '';
        if (!cityId) {
          throw new Error(`City not found: ${cityValue}`);
        }
      } else {
        // Verify the UUID exists
        const cityExists = await this.prisma.city.findUnique({
          where: { id: cityValue },
        });
        if (!cityExists) {
          throw new Error(
            `City with ID ${cityValue} does not exist in database`,
          );
        }
      }

      // Store resolved IDs for use in employee creation
      const resolvedCountry = countryId;
      const resolvedState = stateId;
      const resolvedCity = cityId;

      // Create or find user if officialEmail is provided
      let userId: string | null = null;
      const officialEmailValue = getBodyString('officialEmail');
      if (officialEmailValue) {
        let user = await this.prisma.user.findUnique({
          where: { email: officialEmailValue },
        });

        if (user) {
          userId = user.id;

          // Update user avatar if provided
          const avatarUrlValue = getBodyString('avatarUrl');
          if (avatarUrlValue) {
            await this.prisma.user.update({
              where: { id: userId },
              data: { avatar: avatarUrlValue },
            });
          }
        } else {
          // Create new user
          const employeeNameValue = getBodyString('employeeName');
          const nameParts = employeeNameValue.split(' ');
          const firstName = nameParts[0] || employeeNameValue;
          const lastName = nameParts.slice(1).join(' ') || '';

          // Generate temporary password and hash it
          const tempPassword =
            'Welcome@' + Math.random().toString(36).substring(2, 10);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const hashedPassword: string = await bcrypt.hash(tempPassword, 10);

          const contactNumberValue = getBodyString('contactNumber');
          const avatarUrlValue = getBodyString('avatarUrl');
          const employeeIdValue = getBodyString('employeeId');

          user = await this.prisma.user.create({
            data: {
              email: officialEmailValue,
              password: hashedPassword,
              firstName: firstName,
              lastName: lastName,
              phone: contactNumberValue || null,
              avatar: avatarUrlValue || null,
              employeeId: employeeIdValue,
              mustChangePassword: true,
              status: 'active',
            },
          });
          userId = user.id;
        }
      }

      // Extract all body values safely
      const employeeIdValue = getBodyString('employeeId');
      const employeeNameValue = getBodyString('employeeName');
      const fatherHusbandNameValue = getBodyString('fatherHusbandName');
      const attendanceIdValue = getBodyString('attendanceId');
      const probationExpiryDateValue = getBodyString('probationExpiryDate');
      const cnicNumberValue = getBodyString('cnicNumber');
      const cnicExpiryDateValue = getBodyString('cnicExpiryDate');
      const lifetimeCnicValue = (body as { lifetimeCnic?: unknown })
        .lifetimeCnic;
      const joiningDateValue = getBodyString('joiningDate');
      const dateOfBirthValue = getBodyString('dateOfBirth');
      const nationalityValue = getBodyString('nationality');
      const genderValue = getBodyString('gender');
      const contactNumberValue = getBodyString('contactNumber');
      const emergencyContactNumberValue = getBodyString(
        'emergencyContactNumber',
      );
      const emergencyContactPersonNameValue = getBodyString(
        'emergencyContactPersonName',
      );
      const personalEmailValue = getBodyString('personalEmail');
      const areaValue = getBodyString('area');
      const employeeSalaryValue = (body as { employeeSalary?: unknown })
        .employeeSalary;
      const eobiValue = (body as { eobi?: unknown }).eobi;
      const eobiIdValue = getBodyString('eobiId');
      const eobiCodeValue = getBodyString('eobiCode');
      const eobiNumberValue = getBodyString('eobiNumber');
      const eobiDocumentUrlValue = getBodyString('eobiDocumentUrl');
      const documentUrlsValue = (body as { documentUrls?: unknown })
        .documentUrls;
      // Convert employeeSalary to number, ensuring it's not undefined
      const employeeSalaryNumber =
        typeof employeeSalaryValue === 'number'
          ? employeeSalaryValue
          : typeof employeeSalaryValue === 'string'
            ? parseFloat(employeeSalaryValue) || 0
            : 0;
      const providentFundValue = (body as { providentFund?: unknown })
        .providentFund;
      const overtimeApplicableValue = (
        body as {
          overtimeApplicable?: unknown;
        }
      ).overtimeApplicable;
      const daysOffValue = getBodyString('daysOff');
      const reportingManagerValue = getBodyString('reportingManager');
      const allowRemoteAttendanceValue = (
        body as {
          allowRemoteAttendance?: unknown;
        }
      ).allowRemoteAttendance;
      const currentAddressValue = getBodyString('currentAddress');
      const permanentAddressValue = getBodyString('permanentAddress');
      const bankNameValue = getBodyString('bankName');
      const accountNumberValue = getBodyString('accountNumber');
      const accountTitleValue = getBodyString('accountTitle');
      const selectedEquipmentsValue = (
        body as {
          selectedEquipments?: unknown;
        }
      ).selectedEquipments;
      const qualificationsValue = (body as { qualifications?: unknown })
        .qualifications;

      const created = await this.prisma.employee.create({
        data: {
          userId: userId,
          employeeId: employeeIdValue,
          employeeName: employeeNameValue,
          fatherHusbandName: fatherHusbandNameValue,
          departmentId: resolvedDepartment,
          subDepartmentId: resolvedSubDepartment,
          attendanceId: attendanceIdValue,
          designationId: resolvedDesignation,
          employeeGradeId: resolvedEmployeeGrade,
          maritalStatusId: resolvedMaritalStatus,
          employmentStatusId: resolvedEmploymentStatus,
          probationExpiryDate: probationExpiryDateValue
            ? new Date(probationExpiryDateValue)
            : null,
          cnicNumber: cnicNumberValue,
          cnicExpiryDate: cnicExpiryDateValue
            ? new Date(cnicExpiryDateValue)
            : null,
          lifetimeCnic: !!lifetimeCnicValue,
          joiningDate: joiningDateValue ? new Date(joiningDateValue) : null,
          dateOfBirth: dateOfBirthValue ? new Date(dateOfBirthValue) : null,
          nationality: nationalityValue,
          gender: genderValue,
          contactNumber: contactNumberValue,
          emergencyContactNumber: emergencyContactNumberValue || null,
          emergencyContactPerson: emergencyContactPersonNameValue || null,
          personalEmail: personalEmailValue || null,
          officialEmail: officialEmailValue || null,
          countryId: resolvedCountry,
          stateId: resolvedState,
          cityId: resolvedCity,
          area: areaValue || null,
          employeeSalary: employeeSalaryNumber,
          eobi: !!eobiValue,
          eobiNumber: eobiNumberValue || null,
          eobiDocumentUrl: eobiDocumentUrlValue || null,
          ...(documentUrlsValue
            ? {
              documentUrls: documentUrlsValue as Prisma.InputJsonValue,
            }
            : {}),
          providentFund: !!providentFundValue,
          overtimeApplicable: !!overtimeApplicableValue,
          daysOff: daysOffValue || null,
          reportingManager: reportingManagerValue || null,
          workingHoursPolicyId: resolvedWorkingHoursPolicy,
          locationId: resolvedLocation,
          leavesPolicyId: resolvedLeavesPolicy,
          allocationId: resolvedAllocation,
          allowRemoteAttendance: !!allowRemoteAttendanceValue,
          currentAddress: currentAddressValue || null,
          permanentAddress: permanentAddressValue || null,
          bankName: bankNameValue,
          accountNumber: accountNumberValue,
          accountTitle: accountTitleValue,
          status: 'active',
          equipmentAssignments:
            selectedEquipmentsValue &&
              Array.isArray(selectedEquipmentsValue) &&
              selectedEquipmentsValue.length > 0
              ? {
                create: (selectedEquipmentsValue as unknown[])
                  .filter((equipmentId): equipmentId is string => {
                    // Only include valid UUIDs or non-empty strings
                    if (
                      !equipmentId ||
                      typeof equipmentId !== 'string' ||
                      equipmentId.trim().length === 0
                    ) {
                      return false;
                    }
                    // Check if it's a valid UUID format
                    const isValidUUID =
                      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                        equipmentId.trim(),
                      );
                    if (!isValidUUID) {
                      return false;
                    }
                    return true;
                  })
                  .map((equipmentId: string) => ({
                    equipmentId: equipmentId.trim(),
                    productId: `EQ-${equipmentId.trim().substring(0, 8).toUpperCase()}`, // Generate productId from equipmentId
                    assignedById: ctx.userId,
                    status: 'assigned',
                  })),
              }
              : undefined,
          qualifications:
            qualificationsValue &&
              Array.isArray(qualificationsValue) &&
              qualificationsValue.length > 0
              ? {
                create: (
                  qualificationsValue as Array<{
                    qualification?: unknown;
                    qualificationId?: unknown;
                    instituteId?: unknown;
                    cityId?: unknown;
                    stateId?: unknown;
                    year?: unknown;
                    grade?: unknown;
                  }>
                )
                  .filter((q) => q.qualification || q.qualificationId) // Only include if qualification ID exists
                  .map((q) => {
                    // Safely convert qualification/qualificationId to string
                    const qualificationIdValue =
                      q.qualification || q.qualificationId;
                    const qualificationIdStr =
                      typeof qualificationIdValue === 'string'
                        ? qualificationIdValue
                        : typeof qualificationIdValue === 'number'
                          ? String(qualificationIdValue)
                          : '';

                    // Safely convert other fields
                    const instituteIdStr =
                      q.instituteId && typeof q.instituteId === 'string'
                        ? q.instituteId
                        : q.instituteId &&
                          (typeof q.instituteId === 'number' ||
                            typeof q.instituteId === 'bigint')
                          ? String(q.instituteId)
                          : null;

                    const cityIdStr =
                      q.cityId && typeof q.cityId === 'string'
                        ? q.cityId
                        : q.cityId &&
                          (typeof q.cityId === 'number' ||
                            typeof q.cityId === 'bigint')
                          ? String(q.cityId)
                          : null;

                    const stateIdStr =
                      q.stateId && typeof q.stateId === 'string'
                        ? q.stateId
                        : q.stateId &&
                          (typeof q.stateId === 'number' ||
                            typeof q.stateId === 'bigint')
                          ? String(q.stateId)
                          : null;

                    const yearValue =
                      q.year && typeof q.year === 'number'
                        ? q.year
                        : q.year && typeof q.year === 'string'
                          ? parseInt(q.year, 10)
                          : null;

                    const gradeStr =
                      q.grade && typeof q.grade === 'string'
                        ? q.grade
                        : q.grade &&
                          (typeof q.grade === 'number' ||
                            typeof q.grade === 'bigint')
                          ? String(q.grade)
                          : null;

                    return {
                      qualificationId: qualificationIdStr,
                      instituteId: instituteIdStr,
                      cityId: cityIdStr,
                      stateId: stateIdStr,
                      year: yearValue,
                      grade: gradeStr,
                    };
                  }),
              }
              : undefined,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'employees',
        entity: 'Employee',
        entityId: created.id,
        description: `Created employee ${created.employeeName}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: created };
    } catch (error: unknown) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'employees',
        entity: 'Employee',
        description: 'Failed to create employee',
        errorMessage:
          error instanceof Error ? error.message : 'Unknown error occurred',
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to create employee',
      };
    }
  }

  async update(
    id: string,
    body: Record<string, unknown>,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.employee.findUnique({ where: { id } });

      // Handle qualifications update
      const qualificationsValue = (body as { qualifications?: unknown })
        .qualifications;
      if (qualificationsValue !== undefined) {
        // Delete existing qualifications
        await this.prisma.employeeQualification.deleteMany({
          where: { employeeId: id },
        });
      }

      // Handle equipment assignments update
      const selectedEquipmentsValue = (
        body as {
          selectedEquipments?: unknown;
        }
      ).selectedEquipments;
      if (selectedEquipmentsValue !== undefined) {
        // Mark existing assigned equipment as returned
        await this.prisma.employeeEquipment.updateMany({
          where: {
            employeeId: id,
            status: 'assigned',
          },
          data: {
            status: 'returned',
            returnedDate: new Date(),
            returnedById: ctx.userId,
          },
        });
      }

      // Extract body properties safely
      const employeeNameValue = (body as { employeeName?: unknown })
        .employeeName as string | undefined;
      const fatherHusbandNameValue = (body as { fatherHusbandName?: unknown })
        .fatherHusbandName as string | undefined;
      const departmentValue = (body as { department?: unknown })
        .department as string;
      const subDepartmentValue = (body as { subDepartment?: unknown })
        .subDepartment as string | undefined;
      const employeeGradeValue = (body as { employeeGrade?: unknown })
        .employeeGrade as string | undefined;
      const attendanceIdValue = (body as { attendanceId?: unknown })
        .attendanceId as string | undefined;
      const designationValue = (body as { designation?: unknown })
        .designation as string | undefined;
      const maritalStatusValue = (body as { maritalStatus?: unknown })
        .maritalStatus as string | undefined;
      const employmentStatusValue = (
        body as {
          employmentStatus?: unknown;
        }
      ).employmentStatus as string | undefined;
      const probationExpiryDateValue = (
        body as {
          probationExpiryDate?: unknown;
        }
      ).probationExpiryDate as string | number | Date | undefined;
      const cnicNumberValue = (body as { cnicNumber?: unknown })
        .cnicNumber as string;
      const cnicExpiryDateValue = (body as { cnicExpiryDate?: unknown })
        .cnicExpiryDate as string | number | Date | undefined;
      const lifetimeCnicValue = (body as { lifetimeCnic?: unknown })
        .lifetimeCnic as boolean | undefined;
      const joiningDateValue = (body as { joiningDate?: unknown })
        .joiningDate as string | number | Date | undefined;
      const dateOfBirthValue = (body as { dateOfBirth?: unknown })
        .dateOfBirth as string | number | Date | undefined;
      const nationalityValue = (body as { nationality?: unknown })
        .nationality as string | undefined;
      const genderValue = (body as { gender?: unknown }).gender as
        | string
        | undefined;
      const contactNumberValue = (body as { contactNumber?: unknown })
        .contactNumber as string;
      const emergencyContactNumberValue = (
        body as {
          emergencyContactNumber?: unknown;
        }
      ).emergencyContactNumber as string | undefined;
      const emergencyContactPersonNameValue = (
        body as {
          emergencyContactPersonName?: unknown;
        }
      ).emergencyContactPersonName as string | undefined;
      const personalEmailValue = (body as { personalEmail?: unknown })
        .personalEmail as string;
      const officialEmailValue = (body as { officialEmail?: unknown })
        .officialEmail as string;
      const countryValue = (body as { country?: unknown }).country as
        | string
        | undefined;
      const stateValue = (body as { state?: unknown }).state as
        | string
        | undefined;
      const cityValue = (body as { city?: unknown }).city as string | undefined;
      const areaValue = (body as { area?: unknown }).area as string | undefined;
      const employeeSalaryValue = (body as { employeeSalary?: unknown })
        .employeeSalary;
      const eobiValue = (body as { eobi?: unknown }).eobi as
        | boolean
        | undefined;
      const eobiIdValue = (body as { eobiId?: unknown }).eobiId as string | undefined;
      const eobiCodeValue = (body as { eobiCode?: unknown }).eobiCode as string | undefined;
      const eobiNumberValue = (body as { eobiNumber?: unknown }).eobiNumber as string | undefined;
      const eobiDocumentUrlValue = (body as { eobiDocumentUrl?: unknown }).eobiDocumentUrl as string | undefined;
      const documentUrlsValue = (body as { documentUrls?: unknown })
        .documentUrls;
      const providentFundValue = (body as { providentFund?: unknown })
        .providentFund as boolean | undefined;
      const overtimeApplicableValue = (
        body as {
          overtimeApplicable?: unknown;
        }
      ).overtimeApplicable as boolean | undefined;
      const daysOffValue = (body as { daysOff?: unknown }).daysOff as
        | string
        | undefined;
      const reportingManagerValue = (body as { reportingManager?: unknown })
        .reportingManager as string | undefined;
      const workingHoursPolicyValue = (
        body as {
          workingHoursPolicy?: unknown;
        }
      ).workingHoursPolicy as string | undefined;
      const locationValue = (body as { location?: unknown }).location as
        | string
        | undefined;
      const leavesPolicyValue = (body as { leavesPolicy?: unknown })
        .leavesPolicy as string | undefined;
      const allowRemoteAttendanceValue = (
        body as {
          allowRemoteAttendance?: unknown;
        }
      ).allowRemoteAttendance as boolean | undefined;
      const currentAddressValue = (body as { currentAddress?: unknown })
        .currentAddress as string | undefined;
      const permanentAddressValue = (body as { permanentAddress?: unknown })
        .permanentAddress as string | undefined;
      const bankNameValue = (body as { bankName?: unknown }).bankName as
        | string
        | undefined;
      const accountNumberValue = (body as { accountNumber?: unknown })
        .accountNumber as string | undefined;
      const accountTitleValue = (body as { accountTitle?: unknown })
        .accountTitle as string | undefined;
      const statusValue = (body as { status?: unknown }).status as
        | string
        | undefined;

      // Helper function to check if string is UUID
      const isUUID = (str: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          str,
        );

      // Resolve marital status (handle both ID and name, and empty string to null)
      let resolvedMaritalStatus: string | null | undefined = undefined;
      if (maritalStatusValue !== undefined) {
        if (maritalStatusValue === '' || maritalStatusValue === null) {
          resolvedMaritalStatus = null;
        } else if (!isUUID(maritalStatusValue)) {
          resolvedMaritalStatus = await this.findOrCreateMaritalStatus(
            maritalStatusValue,
            ctx,
          );
        } else {
          resolvedMaritalStatus = maritalStatusValue;
        }
      }

      // Resolve employment status (handle both ID and name, and empty string to null)
      let resolvedEmploymentStatus: string | null | undefined = undefined;
      if (employmentStatusValue !== undefined) {
        if (employmentStatusValue === '' || employmentStatusValue === null) {
          resolvedEmploymentStatus = null;
        } else if (!isUUID(employmentStatusValue)) {
          resolvedEmploymentStatus = await this.findOrCreateEmploymentStatus(
            employmentStatusValue,
            ctx,
          );
        } else {
          resolvedEmploymentStatus = employmentStatusValue;
        }
      }

      // Convert employeeSalary to number if provided
      const employeeSalaryNumber =
        employeeSalaryValue !== undefined
          ? typeof employeeSalaryValue === 'number'
            ? employeeSalaryValue
            : typeof employeeSalaryValue === 'string'
              ? parseFloat(employeeSalaryValue) || existing?.employeeSalary
              : existing?.employeeSalary
          : existing?.employeeSalary;

      const updated = await this.prisma.employee.update({
        where: { id },
        data: {
          employeeName: employeeNameValue ?? existing?.employeeName,
          fatherHusbandName:
            fatherHusbandNameValue ?? existing?.fatherHusbandName,
          departmentId: departmentValue ?? existing?.departmentId,
          subDepartmentId: subDepartmentValue ?? existing?.subDepartmentId,
          employeeGradeId: employeeGradeValue ?? existing?.employeeGradeId,
          attendanceId: attendanceIdValue ?? existing?.attendanceId,
          designationId: designationValue ?? existing?.designationId,
          maritalStatusId: resolvedMaritalStatus !== undefined ? resolvedMaritalStatus : existing?.maritalStatusId,
          employmentStatusId:
            resolvedEmploymentStatus !== undefined ? resolvedEmploymentStatus : existing?.employmentStatusId,
          probationExpiryDate: probationExpiryDateValue
            ? new Date(probationExpiryDateValue)
            : (existing?.probationExpiryDate ?? null),
          cnicNumber: cnicNumberValue ?? existing?.cnicNumber,
          cnicExpiryDate: cnicExpiryDateValue
            ? new Date(cnicExpiryDateValue)
            : (existing?.cnicExpiryDate ?? null),
          lifetimeCnic: lifetimeCnicValue ?? existing?.lifetimeCnic,
          joiningDate: joiningDateValue !== undefined
            ? (joiningDateValue ? new Date(joiningDateValue) : null)
            : existing?.joiningDate,
          dateOfBirth: dateOfBirthValue !== undefined
            ? (dateOfBirthValue ? new Date(dateOfBirthValue) : null)
            : existing?.dateOfBirth,
          nationality: nationalityValue ?? existing?.nationality,
          gender: genderValue ?? existing?.gender,
          contactNumber: contactNumberValue ?? existing?.contactNumber,
          emergencyContactNumber:
            emergencyContactNumberValue ?? existing?.emergencyContactNumber,
          emergencyContactPerson:
            emergencyContactPersonNameValue ?? existing?.emergencyContactPerson,
          personalEmail: personalEmailValue ?? existing?.personalEmail,
          officialEmail: officialEmailValue !== undefined
            ? (officialEmailValue || null)
            : existing?.officialEmail,
          countryId: countryValue ?? existing?.countryId,
          stateId: stateValue ?? existing?.stateId,
          cityId: cityValue ?? existing?.cityId,
          area: areaValue ?? existing?.area,
          employeeSalary: employeeSalaryNumber,
          eobi: eobiValue ?? existing?.eobi,
          eobiId: (body as { eobiId?: unknown }).eobiId !== undefined
            ? ((body as { eobiId?: unknown }).eobiId ? (body as { eobiId?: unknown }).eobiId as string : null)
            : existing?.eobiId,
          eobiCode: (body as { eobiCode?: unknown }).eobiCode !== undefined
            ? ((body as { eobiCode?: unknown }).eobiCode ? (body as { eobiCode?: unknown }).eobiCode as string : null)
            : existing?.eobiCode,
          eobiNumber: eobiNumberValue ?? existing?.eobiNumber,
          eobiDocumentUrl:
            eobiDocumentUrlValue ?? existing?.eobiDocumentUrl ?? null,
          ...(documentUrlsValue !== undefined
            ? {
              documentUrls: documentUrlsValue as Prisma.InputJsonValue,
            }
            : {}),
          providentFund: providentFundValue ?? existing?.providentFund,
          overtimeApplicable:
            overtimeApplicableValue ?? existing?.overtimeApplicable,
          daysOff: daysOffValue ?? existing?.daysOff,
          reportingManager: reportingManagerValue ?? existing?.reportingManager,
          workingHoursPolicyId:
            workingHoursPolicyValue ?? existing?.workingHoursPolicyId,
          locationId: locationValue !== undefined
            ? (locationValue || null)
            : existing?.locationId,
          leavesPolicyId: leavesPolicyValue ?? existing?.leavesPolicyId,
          allowRemoteAttendance:
            allowRemoteAttendanceValue ?? existing?.allowRemoteAttendance,
          currentAddress: currentAddressValue ?? existing?.currentAddress,
          permanentAddress: permanentAddressValue ?? existing?.permanentAddress,
          bankName: bankNameValue ?? existing?.bankName,
          accountNumber: accountNumberValue ?? existing?.accountNumber,
          accountTitle: accountTitleValue ?? existing?.accountTitle,
          status: statusValue ?? existing?.status,
          equipmentAssignments:
            selectedEquipmentsValue !== undefined &&
              Array.isArray(selectedEquipmentsValue) &&
              selectedEquipmentsValue.length > 0
              ? {
                create: (selectedEquipmentsValue as unknown[])
                  .filter((equipmentId): equipmentId is string => {
                    if (
                      !equipmentId ||
                      typeof equipmentId !== 'string' ||
                      equipmentId.trim().length === 0
                    ) {
                      return false;
                    }
                    const isValidUUID =
                      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                        equipmentId.trim(),
                      );
                    return isValidUUID;
                  })
                  .map((equipmentId: string) => ({
                    equipmentId: equipmentId.trim(),
                    productId: `EQ-${equipmentId.trim().substring(0, 8).toUpperCase()}`, // Generate productId from equipmentId
                    assignedById: ctx.userId,
                    status: 'assigned',
                  })),
              }
              : undefined,
          qualifications:
            qualificationsValue !== undefined &&
              Array.isArray(qualificationsValue) &&
              qualificationsValue.length > 0
              ? {
                create: (
                  qualificationsValue as Array<{
                    qualification?: unknown;
                    qualificationId?: unknown;
                    instituteId?: unknown;
                    cityId?: unknown;
                    stateId?: unknown;
                    year?: unknown;
                    grade?: unknown;
                  }>
                )
                  .filter((q) => q.qualification || q.qualificationId)
                  .map((q) => {
                    // Safely convert qualification/qualificationId to string
                    const qualificationIdValue =
                      q.qualification || q.qualificationId;
                    const qualificationIdStr =
                      typeof qualificationIdValue === 'string'
                        ? qualificationIdValue
                        : typeof qualificationIdValue === 'number'
                          ? String(qualificationIdValue)
                          : '';

                    // Safely convert other fields
                    const instituteIdStr =
                      q.instituteId && typeof q.instituteId === 'string'
                        ? q.instituteId
                        : q.instituteId &&
                          (typeof q.instituteId === 'number' ||
                            typeof q.instituteId === 'bigint')
                          ? String(q.instituteId)
                          : null;

                    const cityIdStr =
                      q.cityId && typeof q.cityId === 'string'
                        ? q.cityId
                        : q.cityId &&
                          (typeof q.cityId === 'number' ||
                            typeof q.cityId === 'bigint')
                          ? String(q.cityId)
                          : null;

                    const stateIdStr =
                      q.stateId && typeof q.stateId === 'string'
                        ? q.stateId
                        : q.stateId &&
                          (typeof q.stateId === 'number' ||
                            typeof q.stateId === 'bigint')
                          ? String(q.stateId)
                          : null;

                    const yearValue =
                      q.year && typeof q.year === 'number'
                        ? q.year
                        : q.year && typeof q.year === 'string'
                          ? parseInt(q.year, 10)
                          : null;

                    const gradeStr =
                      q.grade && typeof q.grade === 'string'
                        ? q.grade
                        : q.grade &&
                          (typeof q.grade === 'number' ||
                            typeof q.grade === 'bigint')
                          ? String(q.grade)
                          : null;

                    return {
                      qualificationId: qualificationIdStr,
                      instituteId: instituteIdStr,
                      cityId: cityIdStr,
                      stateId: stateIdStr,
                      year: yearValue,
                      grade: gradeStr,
                    };
                  }),
              }
              : undefined,
        },
      });

      // Handle user creation/update for avatar
      const avatarUrlValue = (body as { avatarUrl?: unknown }).avatarUrl as
        | string
        | undefined;
      const employeeIdValue = (body as { employeeId?: unknown }).employeeId as
        | string
        | undefined;

      if (officialEmailValue) {
        if (updated.userId) {
          // Employee already has a user, update avatar
          if (avatarUrlValue !== undefined) {
            await this.prisma.user.update({
              where: { id: updated.userId },
              data: { avatar: avatarUrlValue },
            });
          }
        } else {
          // Employee doesn't have a user yet, create or link one
          let user = await this.prisma.user.findUnique({
            where: { email: officialEmailValue },
          });

          if (user) {
            // User exists, link to employee
            await this.prisma.employee.update({
              where: { id: id },
              data: { userId: user.id },
            });

            if (avatarUrlValue !== undefined) {
              await this.prisma.user.update({
                where: { id: user.id },
                data: { avatar: avatarUrlValue },
              });
            }
          } else {
            // Create new user
            const nameParts = (
              employeeNameValue ||
              existing?.employeeName ||
              ''
            ).split(' ');
            const firstName = nameParts[0] || 'Employee';
            const lastName = nameParts.slice(1).join(' ') || '';

            // Generate temporary password and hash it
            const tempPassword =
              'Welcome@' + Math.random().toString(36).substring(2, 10);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            const hashedPassword: string = await bcrypt.hash(tempPassword, 10);

            user = await this.prisma.user.create({
              data: {
                email: officialEmailValue,
                password: hashedPassword,
                firstName: firstName,
                lastName: lastName,
                phone: contactNumberValue || existing?.contactNumber || null,
                avatar: avatarUrlValue || null,
                employeeId: employeeIdValue || existing?.employeeId || null,
                mustChangePassword: true,
                status: 'active',
              },
            });

            // Link user to employee
            await this.prisma.employee.update({
              where: { id: id },
              data: { userId: user.id },
            });
          }
        }
      }

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        description: `Updated employee ${updated.employeeName}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return {
        status: true,
        data: updated,
        message: 'Employee updated successfully',
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        description: 'Failed to update employee',
        errorMessage: error instanceof Error ? error.message : String(error),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to update employee',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.employee.findUnique({ where: { id } });
      const removed = await this.prisma.employee.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        description: `Deleted employee ${existing?.employeeName}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: removed };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        description: 'Failed to delete employee',
        errorMessage: error instanceof Error ? error.message : String(error),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete employee' };
    }
  }

  /**
   * Find inactive employee by CNIC for rejoining
   */
  async findByCnicForRejoin(cnic: string) {
    try {
      const employee = await this.prisma.employee.findUnique({
        where: { cnicNumber: cnic },
        include: {
          department: { select: { id: true, name: true } },
          subDepartment: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
          employeeGrade: { select: { id: true, grade: true } },
          maritalStatus: { select: { id: true, name: true } },
          employmentStatus: { select: { id: true, status: true } },
          country: { select: { id: true, name: true } },
          state: { select: { id: true, name: true } },
          city: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          workingHoursPolicy: { select: { id: true, name: true } },
          leavesPolicy: { select: { id: true, name: true } },
          qualifications: {
            include: {
              qualification: { select: { id: true, name: true } },
              institute: { select: { id: true, name: true } },
            },
          },
          rejoiningHistory: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!employee) {
        return {
          status: false,
          message: 'No employee found with this CNIC',
          canRejoin: false,
        };
      }

      // Check if employee is inactive (left the company)
      const isInactive =
        employee.status === 'inactive' ||
        employee.status === 'resigned' ||
        employee.status === 'terminated';

      if (!isInactive) {
        return {
          status: false,
          message:
            'This employee is currently active. Cannot rejoin an active employee.',
          canRejoin: false,
          data: {
            employeeName: employee.employeeName,
            status: employee.status,
          },
        };
      }

      return {
        status: true,
        canRejoin: true,
        data: employee,
        message: `Found inactive employee: ${employee.employeeName}. Ready for rejoining.`,
      };
    } catch (error: any) {
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Error searching for employee',
        canRejoin: false,
      };
    }
  }

  /**
   * Rejoin an existing inactive employee
   * Allows updating ALL fields except CNIC (which is used to identify the employee)
   */
  async rejoinEmployee(
    cnic: string,
    body: any,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Find the employee by CNIC
      const existing = await this.prisma.employee.findUnique({
        where: { cnicNumber: cnic },
        include: {
          department: true,
          subDepartment: true,
          designation: true,
          employeeGrade: true,
          employmentStatus: true,
          country: true,
          state: true,
          city: true,
          location: true,
          workingHoursPolicy: true,
          leavesPolicy: true,
        },
      });

      if (!existing) {
        return { status: false, message: 'Employee not found with this CNIC' };
      }

      // Check if inactive
      const isInactive =
        existing.status === 'inactive' ||
        existing.status === 'resigned' ||
        existing.status === 'terminated';
      if (!isInactive) {
        return { status: false, message: 'Cannot rejoin an active employee' };
      }

      // Validate required fields
      if (!(body as { employeeId?: unknown }).employeeId || !(body as { attendanceId?: unknown }).attendanceId || !(body as { joiningDate?: unknown }).joiningDate) {
        return {
          status: false,
          message: 'Employee ID, Attendance ID, and Joining Date are required',
        };
      }

      // Check for duplicate employeeId if changed
      if ((body as { employeeId?: unknown }).employeeId !== existing.employeeId) {
        const duplicateEmpId = await this.prisma.employee.findUnique({
          where: { employeeId: (body as { employeeId?: unknown }).employeeId as string },
        });
        if (duplicateEmpId) {
          return {
            status: false,
            message: `Employee ID ${(body as { employeeId?: unknown }).employeeId as string} is already in use`,
          };
        }
      }

      // Check for duplicate officialEmail if changed
      if ((body as { officialEmail?: unknown }).officialEmail && (body as { officialEmail?: unknown }).officialEmail !== existing.officialEmail) {
        const duplicateEmail = await this.prisma.employee.findUnique({
          where: { officialEmail: (body as { officialEmail?: unknown }).officialEmail as string },
        });
        if (duplicateEmail) {
          return {
            status: false,
            message: `Official Email ${(body as { officialEmail?: unknown }).officialEmail as string} is already in use`,
          };
        }
      }

      // Handle legacy field mappings (for backward compatibility)
      const resolveField = (
        newValue: unknown,
        legacyValue: unknown,
        existingValue: unknown,
      ) => {
        if (newValue !== undefined && newValue !== null && newValue !== '')
          return newValue;
        if (
          legacyValue !== undefined &&
          legacyValue !== null &&
          legacyValue !== ''
        )
          return legacyValue;
        return existingValue;
      };

      // Prepare update data - allow ALL fields to be updated
      const updateData: Prisma.EmployeeUpdateInput = {
        employeeId: (body as { employeeId?: unknown }).employeeId as string,
        attendanceId: (body as { attendanceId?: unknown }).attendanceId as string,
        joiningDate: new Date((body as { joiningDate?: unknown }).joiningDate as string),
        status: 'active',
        isRejoined: true,
        originalJoiningDate:
          existing.originalJoiningDate || existing.joiningDate,
        lastExitDate: null, // Clear exit date on rejoin
        rejoinCount: existing.rejoinCount + 1,
      };

      // Update all fields that are provided (except CNIC which is immutable)
      if ((body as { employeeName?: unknown }).employeeName !== undefined)
        updateData.employeeName = (body as { employeeName?: unknown }).employeeName as string;
      if ((body as { fatherHusbandName?: unknown }).fatherHusbandName !== undefined)
        updateData.fatherHusbandName = (body as { fatherHusbandName?: unknown }).fatherHusbandName as string;
      if ((body as { departmentId?: string }).departmentId !== undefined || (body as { department?: unknown }).department !== undefined) {
        const resolvedDepartmentId = resolveField(
          (body as { departmentId?: unknown }).departmentId,
          (body as { department?: unknown }).department,
          existing.departmentId,
        ) as string;
        updateData.department = { connect: { id: resolvedDepartmentId } };
      }
      if (
        (body as { subDepartmentId?: string }).subDepartmentId !== undefined ||
        (body as { subDepartment?: unknown }).subDepartment !== undefined
      ) {
        const resolvedSubDepartmentId = resolveField(
          (body as { subDepartmentId?: unknown }).subDepartmentId,
          (body as { subDepartment?: unknown }).subDepartment,
          existing.subDepartmentId,
        ) as string;
        updateData.subDepartment = { connect: { id: resolvedSubDepartmentId } };
      }
      if (
        (body as { employeeGradeId?: string }).employeeGradeId !== undefined ||
        (body as { employeeGrade?: unknown }).employeeGrade !== undefined
      ) {
        const resolvedEmployeeGradeId = resolveField(
          (body as { employeeGradeId?: unknown }).employeeGradeId,
          (body as { employeeGrade?: unknown }).employeeGrade,
          existing.employeeGradeId,
        ) as string;
        updateData.employeeGrade = { connect: { id: resolvedEmployeeGradeId } };
      }
      if ((body as { designationId?: string }).designationId !== undefined || (body as { designation?: unknown }).designation !== undefined) {
        const resolvedDesignationId = resolveField(
          (body as { designationId?: unknown }).designationId,
          (body as { designation?: unknown }).designation,
          existing.designationId,
        ) as string;
        updateData.designation = { connect: { id: resolvedDesignationId } };
      }
      if (
        (body as { maritalStatusId?: string }).maritalStatusId !== undefined ||
        (body as { maritalStatus?: unknown }).maritalStatus !== undefined
      ) {
        const resolvedMaritalStatusId = resolveField(
          (body as { maritalStatusId?: unknown }).maritalStatusId,
          (body as { maritalStatus?: unknown }).maritalStatus,
          existing.maritalStatusId,
        ) as string;
        updateData.maritalStatus = { connect: { id: resolvedMaritalStatusId } };
      }
      if (
        (body as { employmentStatusId?: string }).employmentStatusId !== undefined ||
        (body as { employmentStatus?: unknown }).employmentStatus !== undefined
      ) {
        const resolvedEmploymentStatusId = resolveField(
          (body as { employmentStatusId?: unknown }).employmentStatusId,
          (body as { employmentStatus?: unknown }).employmentStatus,
          existing.employmentStatusId,
        ) as string;
        updateData.employmentStatus = { connect: { id: resolvedEmploymentStatusId } };
      }
      if ((body as { probationExpiryDate?: unknown }).probationExpiryDate !== undefined) {
        updateData.probationExpiryDate = (body as { probationExpiryDate?: unknown }).probationExpiryDate
          ? new Date((body as { probationExpiryDate?: unknown }).probationExpiryDate as string)
          : null;
      }
      if ((body as { cnicExpiryDate?: unknown }).cnicExpiryDate !== undefined) {
        updateData.cnicExpiryDate = (body as { cnicExpiryDate?: unknown }).cnicExpiryDate
          ? new Date((body as { cnicExpiryDate?: unknown }).cnicExpiryDate as string)
          : null;
      }
      if ((body as { lifetimeCnic?: unknown }).lifetimeCnic !== undefined)
        updateData.lifetimeCnic = (body as { lifetimeCnic?: unknown }).lifetimeCnic as boolean;
      if ((body as { dateOfBirth?: unknown }).dateOfBirth !== undefined)
        updateData.dateOfBirth = new Date((body as { dateOfBirth?: unknown }).dateOfBirth as string);
      if ((body as { nationality?: unknown }).nationality !== undefined)
        updateData.nationality = (body as { nationality?: unknown }).nationality as string;
      if ((body as { gender?: unknown }).gender !== undefined)
        updateData.gender = (body as { gender?: unknown }).gender as string;
      if ((body as { contactNumber?: unknown }).contactNumber !== undefined)
        updateData.contactNumber = (body as { contactNumber?: unknown }).contactNumber as string;
      if ((body as { emergencyContactNumber?: unknown }).emergencyContactNumber !== undefined)
        updateData.emergencyContactNumber = (body as { emergencyContactNumber?: unknown }).emergencyContactNumber as string;
      if ((body as { emergencyContactPerson?: unknown }).emergencyContactPerson !== undefined)
        updateData.emergencyContactPerson = (body as { emergencyContactPerson?: unknown }).emergencyContactPerson as string;
      if ((body as { personalEmail?: unknown }).personalEmail !== undefined)
        updateData.personalEmail = (body as { personalEmail?: unknown }).personalEmail as string;
      if ((body as { officialEmail?: unknown }).officialEmail !== undefined)
        updateData.officialEmail = (body as { officialEmail?: unknown }).officialEmail as string;
      if ((body as { countryId?: string }).countryId !== undefined || (body as { country?: unknown }).country !== undefined) {
        const resolvedCountryId = resolveField(
          (body as { countryId?: unknown }).countryId,
          (body as { country?: unknown }).country,
          existing.countryId,
        ) as string;
        updateData.country = { connect: { id: resolvedCountryId } };
      }
      if ((body as { stateId?: string }).stateId !== undefined || (body as { state?: unknown }).state !== undefined) {
        const resolvedStateId = resolveField(
          (body as { stateId?: unknown }).stateId,
          (body as { state?: unknown }).state,
          existing.stateId,
        ) as string;
        updateData.state = { connect: { id: resolvedStateId } };
      }
      if ((body as { cityId?: string }).cityId !== undefined || (body as { city?: unknown }).city !== undefined) {
        const resolvedCityId = resolveField(
          (body as { cityId?: unknown }).cityId,
          (body as { city?: unknown }).city,
          existing.cityId,
        ) as string;
        updateData.city = { connect: { id: resolvedCityId } };
      }
      if ((body as { area?: unknown }).area !== undefined) updateData.area = (body as { area?: unknown }).area as string;
      if ((body as { employeeSalary?: unknown }).employeeSalary !== undefined)
        updateData.employeeSalary = (body as { employeeSalary?: unknown }).employeeSalary as number;
      if ((body as { eobi?: unknown }).eobi !== undefined) updateData.eobi = (body as { eobi?: unknown }).eobi as boolean;
      if ((body as { eobiId?: unknown }).eobiId !== undefined)
        updateData.eobiId = (body as { eobiId?: unknown }).eobiId ? (body as { eobiId?: unknown }).eobiId as string : null;
      if ((body as { eobiCode?: unknown }).eobiCode !== undefined)
        updateData.eobiCode = (body as { eobiCode?: unknown }).eobiCode ? (body as { eobiCode?: unknown }).eobiCode as string : null;
      if ((body as { eobiNumber?: unknown }).eobiNumber !== undefined)
        updateData.eobiNumber = (body as { eobiNumber?: unknown }).eobiNumber as string;
      if ((body as { eobiDocumentUrl?: unknown }).eobiDocumentUrl !== undefined)
        updateData.eobiDocumentUrl = (body as { eobiDocumentUrl?: unknown }).eobiDocumentUrl as string;
      if ((body as { documentUrls?: unknown }).documentUrls !== undefined)
        updateData.documentUrls = (body as { documentUrls?: unknown }).documentUrls as Prisma.InputJsonValue;
      if ((body as { providentFund?: unknown }).providentFund !== undefined)
        updateData.providentFund = (body as { providentFund?: unknown }).providentFund as boolean;
      if ((body as { overtimeApplicable?: unknown }).overtimeApplicable !== undefined)
        updateData.overtimeApplicable = (body as { overtimeApplicable?: unknown }).overtimeApplicable as boolean;
      if ((body as { daysOff?: unknown }).daysOff !== undefined) updateData.daysOff = (body as { daysOff?: unknown }).daysOff as string;
      if ((body as { reportingManager?: unknown }).reportingManager !== undefined)
        updateData.reportingManager = (body as { reportingManager?: unknown }).reportingManager as string;
      if (
        (body as { workingHoursPolicyId?: unknown }).workingHoursPolicyId !== undefined ||
        (body as { workingHoursPolicy?: unknown }).workingHoursPolicy !== undefined
      ) {
        const resolvedWorkingHoursPolicyId = resolveField(
          (body as { workingHoursPolicyId?: unknown }).workingHoursPolicyId,
          (body as { workingHoursPolicy?: unknown }).workingHoursPolicy,
          existing.workingHoursPolicyId,
        ) as string;
        updateData.workingHoursPolicy = { connect: { id: resolvedWorkingHoursPolicyId } };
      }
      if ((body as { locationId?: string }).locationId !== undefined || (body as { location?: unknown }).location !== undefined) {
        const resolvedLocationId = resolveField(
          (body as { locationId?: unknown }).locationId,
          (body as { location?: unknown }).location,
          existing.locationId,
        ) as string;
        updateData.location = { connect: { id: resolvedLocationId } };
      }
      if (
        (body as { leavesPolicyId?: string }).leavesPolicyId !== undefined ||
        (body as { leavesPolicy?: unknown }).leavesPolicy !== undefined
      ) {
        const resolvedLeavesPolicyId = resolveField(
          (body as { leavesPolicyId?: unknown }).leavesPolicyId,
          (body as { leavesPolicy?: unknown }).leavesPolicy,
          existing.leavesPolicyId,
        ) as string;
        updateData.leavesPolicy = { connect: { id: resolvedLeavesPolicyId } };
      }
      if ((body as { allowRemoteAttendance?: unknown }).allowRemoteAttendance !== undefined)
        updateData.allowRemoteAttendance = (body as { allowRemoteAttendance?: unknown }).allowRemoteAttendance as boolean;
      if ((body as { currentAddress?: unknown }).currentAddress !== undefined)
        updateData.currentAddress = (body as { currentAddress?: unknown }).currentAddress as string;
      if ((body as { permanentAddress?: unknown }).permanentAddress !== undefined)
        updateData.permanentAddress = (body as { permanentAddress?: unknown }).permanentAddress as string;
      if ((body as { bankName?: unknown }).bankName !== undefined) updateData.bankName = (body as { bankName?: unknown }).bankName as string;
      if ((body as { accountNumber?: unknown }).accountNumber !== undefined)
        updateData.accountNumber = (body as { accountNumber?: unknown }).accountNumber as string;
      if ((body as { accountTitle?: unknown }).accountTitle !== undefined)
        updateData.accountTitle = (body as { accountTitle?: unknown }).accountTitle as string;

      // Track changed fields
      const changedFields: string[] = [];
      const previousValues: any = {};
      const newValues: any = {};

      // Compare and track changes
      Object.keys(updateData).forEach((key) => {
        if (
          key === 'status' ||
          key === 'isRejoined' ||
          key === 'originalJoiningDate' ||
          key === 'rejoinCount' ||
          key === 'lastExitDate'
        ) {
          return; // Skip system fields
        }
        const oldValue = existing[key as keyof typeof existing];
        const newValue = updateData[key as keyof typeof updateData];

        // Convert dates to strings for comparison
        const oldValStr =
          oldValue instanceof Date ? oldValue.toISOString() : oldValue;
        const newValStr =
          newValue instanceof Date ? newValue.toISOString() : newValue;

        if (oldValStr !== newValStr) {
          changedFields.push(key);
          // Use object literals and avoid unsafe 'any' type member access
          (previousValues as Record<string, unknown>)[key] = oldValue;
          (newValues as Record<string, unknown>)[key] = newValue;
        }
      });

      // Update the employee record
      const rejoined = await this.prisma.employee.update({
        where: { cnicNumber: cnic },
        data: updateData,
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
        },
      });

      // Create comprehensive rejoining history record
      // Using type assertion for JSON fields until Prisma migration is run
      await this.prisma.employeeRejoiningHistory.create({
        data: {
          employeeId: existing.id,
          previousEmployeeId: existing.employeeId,
          newEmployeeId: (body as { employeeId?: unknown }).employeeId as string,
          previousAttendanceId: existing.attendanceId,
          newAttendanceId: (body as { attendanceId?: unknown }).attendanceId as string,
          previousExitDate: existing.lastExitDate || existing.updatedAt,
          rejoiningDate: new Date((body as { joiningDate?: unknown }).joiningDate as string),
          previousDepartmentId: existing.departmentId,
          newDepartmentId: updateData.department?.connect?.id || existing.departmentId,
          previousDesignationId: existing.designationId,
          newDesignationId: updateData.designation?.connect?.id || existing.designationId,
          previousSalary: existing.employeeSalary,
          newSalary: (updateData.employeeSalary as unknown as string) || existing.employeeSalary,
          remarks: (body as { remarks?: unknown }).remarks as string | undefined,
          createdById: ctx.userId,
          // JSON fields - convert to plain JSON objects for Prisma
          previousValues: JSON.parse(JSON.stringify(existing)) as Prisma.InputJsonValue,
          newValues: JSON.parse(JSON.stringify(rejoined)) as Prisma.InputJsonValue,
          changedFields: JSON.parse(JSON.stringify(changedFields)) as Prisma.InputJsonValue,
        },
      });

      // Reactivate user if exists
      if (existing.userId) {
        await this.prisma.user.update({
          where: { id: existing.userId },
          data: { status: 'active' },
        });
      }

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'employees',
        entity: 'Employee',
        entityId: existing.id,
        description: `Rejoined employee ${rejoined.employeeName} with new Employee ID: ${(body as { employeeId?: unknown }).employeeId as string}. Changed fields: ${changedFields.join(', ') || 'none'}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(rejoined),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return {
        status: true,
        data: rejoined,
        message: `Employee ${rejoined.employeeName} has been successfully rejoined with Employee ID: ${(body as { employeeId?: unknown }).employeeId as string}`,
        changedFields: changedFields.length > 0 ? changedFields : undefined,
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'employees',
        entity: 'Employee',
        description: `Failed to rejoin employee with CNIC: ${cnic}`,
        errorMessage: error instanceof Error ? error.message : String(error),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to rejoin employee',
      };
    }
  }

  /**
   * Get rejoining history for an employee
   * Returns all rejoin events with full before/after snapshots
   * Use this to see what changed during each rejoin
   */
  async getRejoiningHistory(employeeId: string) {
    try {
      const history = await this.prisma.employeeRejoiningHistory.findMany({
        where: { employeeId },
        orderBy: { rejoiningDate: 'desc' },
        include: {
          createdBy: {
            select: { firstName: true, lastName: true },
          },
        },
      });

      // Enhance history with readable change summaries
      // Using type assertion to access JSON fields
      const enhancedHistory = history.map((entry) => {
        const entryWithJson = entry as typeof entry & {
          previousValues?: any;
          newValues?: any;
          changedFields?: any;
        };
        return {
          ...entry,
          // Extract key changes for easy viewing
          keyChanges:
            entryWithJson.changedFields &&
              Array.isArray(entryWithJson.changedFields)
              ? entryWithJson.changedFields
              : [],
          // Previous state snapshot
          previousState: entryWithJson.previousValues as Prisma.InputJsonValue,
          // New state snapshot
          newState: entryWithJson.newValues as Prisma.InputJsonValue,
        };
      });

      return { status: true, data: enhancedHistory };
    } catch (error: any) {
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to get rejoining history',
      };
    }
  }

  /**
   * Helper function to find or create department by name
   */
  private async findOrCreateDepartment(
    name: string,
    ctx: { userId?: string },
  ): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Department name is required');
    }
    const trimmedName = name.trim();

    // Try to find existing department
    let department = await this.prisma.department.findUnique({
      where: { name: trimmedName },
    });

    // If not found, create it
    if (!department) {
      department = await this.prisma.department.create({
        data: {
          name: trimmedName,
          createdById: ctx.userId || null,
        },
      });
    }

    return department.id;
  }

  /**
   * Helper function to find or create sub-department by name within a department
   */
  private async findOrCreateSubDepartment(
    name: string,
    departmentId: string,
    ctx: { userId?: string },
  ): Promise<string | null> {
    if (!name || name.trim() === '') {
      return null;
    }
    const trimmedName = name.trim();

    // Try to find existing sub-department
    let subDepartment = await this.prisma.subDepartment.findFirst({
      where: {
        name: trimmedName,
        departmentId: departmentId,
      },
    });

    // If not found, create it
    if (!subDepartment) {
      subDepartment = await this.prisma.subDepartment.create({
        data: {
          name: trimmedName,
          departmentId: departmentId,
          createdById: ctx.userId || null,
        },
      });
    }

    return subDepartment.id;
  }

  /**
   * Helper function to find or create designation by name
   */
  private async findOrCreateDesignation(
    name: string,
    ctx: { userId?: string },
  ): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Designation name is required');
    }
    const trimmedName = name.trim();

    let designation = await this.prisma.designation.findUnique({
      where: { name: trimmedName },
    });

    if (!designation) {
      designation = await this.prisma.designation.create({
        data: {
          name: trimmedName,
          createdById: ctx.userId || null,
        },
      });
    }

    return designation.id;
  }

  /**
   * Helper function to find or create employee grade by grade
   */
  private async findOrCreateEmployeeGrade(
    grade: string,
    ctx: { userId?: string },
  ): Promise<string> {
    if (!grade || grade.trim() === '') {
      throw new Error('Employee grade is required');
    }
    const trimmedGrade = grade.trim();

    let employeeGrade = await this.prisma.employeeGrade.findUnique({
      where: { grade: trimmedGrade },
    });

    if (!employeeGrade) {
      employeeGrade = await this.prisma.employeeGrade.create({
        data: {
          grade: trimmedGrade,
          createdById: ctx.userId || null,
        },
      });
    }

    return employeeGrade.id;
  }

  /**
   * Helper function to find or create marital status by name
   */
  private async findOrCreateMaritalStatus(
    name: string,
    ctx: { userId?: string },
  ): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Marital status is required');
    }
    const trimmedName = name.trim();

    let maritalStatus = await this.prisma.maritalStatus.findUnique({
      where: { name: trimmedName },
    });

    if (!maritalStatus) {
      maritalStatus = await this.prisma.maritalStatus.create({
        data: {
          name: trimmedName,
          createdById: ctx.userId || null,
        },
      });
    }

    return maritalStatus.id;
  }

  /**
   * Helper function to find or create employment status by status
   */
  private async findOrCreateEmploymentStatus(
    status: string,
    ctx: { userId?: string },
  ): Promise<string> {
    if (!status || status.trim() === '') {
      throw new Error('Employment status is required');
    }
    const trimmedStatus = status.trim();

    let employmentStatus = await this.prisma.employeeStatus.findUnique({
      where: { status: trimmedStatus },
    });

    if (!employmentStatus) {
      employmentStatus = await this.prisma.employeeStatus.create({
        data: {
          status: trimmedStatus,
          createdById: ctx.userId || null,
        },
      });
    }

    return employmentStatus.id;
  }

  /**
   * Helper function to find country by name
   */
  private async findCountryByName(name: string): Promise<string | null> {
    if (!name || name.trim() === '') {
      return null;
    }
    const trimmedName = name.trim();

    // Common country name mappings
    const countryMappings: Record<string, string> = {
      pakistan: 'Pakistan',
      india: 'India',
      bangladesh: 'Bangladesh',
      'sri lanka': 'Sri Lanka',
      nepal: 'Nepal',
      afghanistan: 'Afghanistan',
      'united states': 'United States',
      usa: 'United States',
      uk: 'United Kingdom',
      'united kingdom': 'United Kingdom',
    };

    // Try mapped name first
    const mappedName = countryMappings[trimmedName.toLowerCase()];
    const searchName = mappedName || trimmedName;

    // Try multiple search strategies
    let country = await this.prisma.country.findFirst({
      where: {
        OR: [
          { name: { equals: searchName, mode: 'insensitive' } },
          { nicename: { equals: searchName, mode: 'insensitive' } },
          { name: { contains: searchName, mode: 'insensitive' } },
          { nicename: { contains: searchName, mode: 'insensitive' } },
        ],
      },
    });

    // If still not found and we used a mapping, try original name
    if (!country && mappedName) {
      country = await this.prisma.country.findFirst({
        where: {
          OR: [
            { name: { equals: trimmedName, mode: 'insensitive' } },
            { nicename: { equals: trimmedName, mode: 'insensitive' } },
            { name: { contains: trimmedName, mode: 'insensitive' } },
            { nicename: { contains: trimmedName, mode: 'insensitive' } },
          ],
        },
      });
    }

    return country?.id || null;
  }

  /**
   * Helper function to find state by name and country
   */
  private async findStateByName(
    name: string,
    countryId: string,
  ): Promise<string | null> {
    if (!name || name.trim() === '' || !countryId) {
      return null;
    }
    const trimmedName = name.trim();

    // Common state/province name mappings for Pakistan
    const stateMappings: Record<string, string> = {
      sindh: 'Sindh',
      punjab: 'Punjab',
      'khyber pakhtunkhwa': 'Khyber Pakhtunkhwa',
      kpk: 'Khyber Pakhtunkhwa',
      balochistan: 'Balochistan',
      'gilgit baltistan': 'Gilgit-Baltistan',
      gb: 'Gilgit-Baltistan',
    };

    const mappedName = stateMappings[trimmedName.toLowerCase()];
    const searchName = mappedName || trimmedName;

    // Try exact match first
    let state = await this.prisma.state.findFirst({
      where: {
        name: { equals: searchName, mode: 'insensitive' },
        countryId: countryId,
      },
    });

    // If not found, try contains search
    if (!state) {
      state = await this.prisma.state.findFirst({
        where: {
          name: { contains: searchName, mode: 'insensitive' },
          countryId: countryId,
        },
      });
    }

    // If still not found and we used a mapping, try original name
    if (!state && mappedName) {
      state = await this.prisma.state.findFirst({
        where: {
          OR: [
            {
              name: { equals: trimmedName, mode: 'insensitive' },
              countryId: countryId,
            },
            {
              name: { contains: trimmedName, mode: 'insensitive' },
              countryId: countryId,
            },
          ],
        },
      });
    }

    return state?.id || null;
  }

  /**
   * Helper function to find city by name, state, and country
   */
  private async findCityByName(
    name: string,
    stateId: string,
  ): Promise<string | null> {
    if (!name || name.trim() === '' || !stateId) {
      return null;
    }
    const trimmedName = name.trim();

    // Common city name mappings
    const cityMappings: Record<string, string> = {
      karachi: 'Karachi',
      lahore: 'Lahore',
      islamabad: 'Islamabad',
      rawalpindi: 'Rawalpindi',
      faisalabad: 'Faisalabad',
      multan: 'Multan',
      peshawar: 'Peshawar',
      quetta: 'Quetta',
      hyderabad: 'Hyderabad',
      sialkot: 'Sialkot',
    };

    const mappedName = cityMappings[trimmedName.toLowerCase()];
    const searchName = mappedName || trimmedName;

    // Try exact match first
    let city = await this.prisma.city.findFirst({
      where: {
        name: { equals: searchName, mode: 'insensitive' },
        stateId: stateId,
      },
    });

    // If not found, try contains search
    if (!city) {
      city = await this.prisma.city.findFirst({
        where: {
          name: { contains: searchName, mode: 'insensitive' },
          stateId: stateId,
        },
      });
    }

    // If still not found and we used a mapping, try original name
    if (!city && mappedName) {
      city = await this.prisma.city.findFirst({
        where: {
          OR: [
            {
              name: { equals: trimmedName, mode: 'insensitive' },
              stateId: stateId,
            },
            {
              name: { contains: trimmedName, mode: 'insensitive' },
              stateId: stateId,
            },
          ],
        },
      });
    }

    return city?.id || null;
  }

  /**
   * Helper function to find or create location by name
   */
  private async findOrCreateLocation(
    locationName: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<string> {
    if (!locationName) {
      throw new Error('Location name is required');
    }

    let location = await this.prisma.location.findUnique({
      where: { name: locationName },
    });

    if (!location) {
      location = await this.prisma.location.create({
        data: {
          name: locationName,
          createdById: ctx.userId,
        },
      });
    }

    return location.id;
  }

  /**
   * Helper function to find or create working hours policy by name
   */
  private async findOrCreateWorkingHoursPolicy(
    name: string,
    ctx: { userId?: string },
  ): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Working hours policy name is required');
    }
    const trimmedName = name.trim();

    let policy = await this.prisma.workingHoursPolicy.findUnique({
      where: { name: trimmedName },
    });

    if (!policy) {
      // Create with default values - these should be set properly in production
      policy = await this.prisma.workingHoursPolicy.create({
        data: {
          name: trimmedName,
          startWorkingHours: '09:00',
          endWorkingHours: '18:00',
          createdById: ctx.userId || null,
        },
      });
    }

    return policy.id;
  }

  /**
   * Helper function to find or create leaves policy by name
   */
  private async findOrCreateLeavesPolicy(
    name: string,
    ctx: { userId?: string },
  ): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Leaves policy name is required');
    }
    const trimmedName = name.trim();

    let policy = await this.prisma.leavesPolicy.findUnique({
      where: { name: trimmedName },
    });

    if (!policy) {
      policy = await this.prisma.leavesPolicy.create({
        data: {
          name: trimmedName,
          createdById: ctx.userId || null,
        },
      });
    }
    return policy.id;
  }

  /**
   * Helper function to find or create allocation by name
   */
  private async findOrCreateAllocation(
    name: string,
    ctx: { userId?: string },
  ): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Allocation name is required');
    }
    const trimmedName = name.trim();

    let allocation = await this.prisma.allocation.findUnique({
      where: { name: trimmedName },
    });

    if (!allocation) {
      allocation = await this.prisma.allocation.create({
        data: {
          name: trimmedName,
          createdById: ctx.userId || null,
        },
      });
    }

    return allocation.id;
  }

  /**
   * Helper function to parse various date formats
   */
  private parseDate(dateStr: string): Date | null {
    if (!dateStr || dateStr.trim() === '') return null;

    try {
      // Try standard ISO format first
      const isoDate = new Date(dateStr);
      if (!isNaN(isoDate.getTime())) {
        return isoDate;
      }

      // Handle DD-MM-YYYY format (27-11-1982)
      if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) {
        const [day, month, year] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
      }

      // Handle MM/DD/YYYY format
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
        const [month, day, year] = dateStr.split('/').map(Number);
        return new Date(year, month - 1, day);
      }

      // Handle formats like "November 11th,2025" or "November 11th, 2025"
      if (/^[A-Za-z]+\s+\d{1,2}(st|nd|rd|th)?,?\s*\d{4}$/.test(dateStr)) {
        // Remove ordinal suffixes (st, nd, rd, th)
        const cleaned = dateStr
          .replace(/(st|nd|rd|th)/g, '')
          .replace(/,/g, ' ');
        const parsed = new Date(cleaned);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }

      // Handle DD-MMM-YY or DD-MMM-YYYY format (e.g. "2-Oct-00", "02-Oct-2000")
      if (/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(dateStr)) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }

      return null;
    } catch (error: any) {
      console.error('Error parsing date:', error);
      return null;
    }
  }

  /**
   * Bulk upload employees from CSV or Excel file
   * Expected format: EmployeeID,EmployeeName,FatherHusbandName,Department,SubDepartment,EmployeeGrade,AttendanceID,Designation,MaritalStatus,EmploymentStatus,ProbationExpiryDate,CNICNumber,CNICExpiryDate,LifetimeCNIC,JoiningDate,DateOfBirth,Nationality,Gender,ContactNumber,EmergencyContactNumber,EmergencyContactPerson,PersonalEmail,OfficialEmail,Country,Province,City,Area,EmployeeSalary,EOBI,EOBINumber,ProvidentFund,OvertimeApplicable,DaysOff,ReportingManager,WorkingHoursPolicy,Location,LeavesPolicy,AllowRemoteAttendance,CurrentAddress,PermanentAddress,BankName,AccountNumber,AccountTitle,AccountType,Password,Roles,SelectedEquipments,Status
   */
  async bulkUploadFromCSV(
    filePath: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const fs = await import('fs');
      const path = await import('path');

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error('File not found');
      }

      // Detect file type from extension
      const fileExtension = path.extname(filePath).toLowerCase();
      let records: Array<Record<string, string>>;

      if (fileExtension === '.xlsx') {
        // Parse Excel file
        try {
          const XLSX = await import('xlsx');

          // Read file buffer
          const fileBuffer = fs.readFileSync(filePath);

          // Parse workbook from buffer
          const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

          // Get first sheet
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) {
            throw new Error('Excel file has no sheets');
          }

          const worksheet = workbook.Sheets[sheetName];

          // Convert to array of arrays (first row is headers)
          const excelData = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '', // Default value for empty cells
            raw: false, // Convert all values to strings
          });

          // Validate we got data
          if (!excelData || excelData.length === 0) {
            throw new Error('Excel file is empty');
          }

          // Convert array of arrays to array of objects (first row is headers)
          const headers = excelData[0] as string[];
          if (!headers || headers.length === 0) {
            throw new Error('Excel file has no header row');
          }

          records = excelData
            .slice(1)
            .map((row: any[]) => {
              const obj: Record<string, string> = {};
              headers.forEach((header, index) => {
                obj[header] = row[index] ? String(row[index]).trim() : '';
              });
              return obj;
            })
            .filter((row: Record<string, string>) => {
              // Filter out completely empty rows
              return Object.values(row).some(
                (val) => val && val.trim().length > 0,
              );
            });
        } catch (error: any) {
          throw new Error(`Failed to parse Excel file: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        // Parse CSV file
        const { parse } = await import('csv-parse/sync');

        // Read file and validate it's a text file
        let fileContent: string;
        try {
          fileContent = fs.readFileSync(filePath, 'utf-8');
        } catch (error: any) {
          console.error('Error reading file:', error);
          throw new Error(
            'Invalid file format. The file appears to be corrupted or not a valid CSV file.',
          );
        }

        // Validate file content is not empty
        if (!fileContent || fileContent.trim().length === 0) {
          throw new Error('The CSV file is empty');
        }

        // Try to parse CSV with better error handling
        try {
          records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true, // Handle BOM (Byte Order Mark) if present
            relax_quotes: true, // Relax quote handling
            relax_column_count: true, // Allow inconsistent column counts
          });
        } catch (parseError: any) {
          console.error('Error parsing CSV:', parseError);
          throw new Error(`Invalid CSV format: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        }
      }

      // Validate we got records
      if (!records || records.length === 0) {
        throw new Error(
          'No valid records found in file. Please check the file format.',
        );
      }

      const results: any[] = [];
      const errors: Array<{
        row: Record<string, string>;
        error: string;
        stack?: string;
      }> = [];

      for (let index = 0; index < records.length; index++) {
        const record = records[index];

        try {
          // Normalize keys to handle case sensitivity and typos
          const normalizedRecord: any = {};
          for (const key of Object.keys(record)) {
            const lowerKey = key
              .trim()
              .toLowerCase()
              .replace(/['"]/g, '') // Remove quotes
              .replace(/\s+/g, ' '); // Normalize spaces

            if (lowerKey === 'department') {
              normalizedRecord.department = record[key];
            } else if (lowerKey === 'designation') {
              normalizedRecord.designation = record[key];
            } else if (
              lowerKey === 'employee grade' ||
              lowerKey === 'employee-grade'
            ) {
              normalizedRecord.employeeGrade = record[key];
            } else if (
              lowerKey === 'marital status' ||
              lowerKey === 'martial status' // Handle typo 'martial'
            ) {
              normalizedRecord.maritalStatus = record[key];
            } else if (
              lowerKey === 'employment status' ||
              lowerKey === 'employment-status'
            ) {
              normalizedRecord.employmentStatus = record[key];
            } else if (
              lowerKey === 'official email' ||
              lowerKey === 'officail email' // Handle typo 'officail'
            ) {
              normalizedRecord.officialEmail = record[key];
            } else if (lowerKey === 'joining date') {
              normalizedRecord.joiningDate = record[key];
            } else if (
              lowerKey === 'date of birth' ||
              lowerKey === 'date od birth' // Handle typo 'od'
            ) {
              normalizedRecord.dateOfBirth = record[key];
            } else if (
              lowerKey === 'sub department' ||
              lowerKey === 'sub-department'
            ) {
              normalizedRecord.subDepartment = record[key];
            } else if (lowerKey === 'employee name') {
              normalizedRecord.employeeName = record[key];
            } else if (
              lowerKey === 'father/husband name' ||
              lowerKey === 'father / husband name' ||
              lowerKey === 'fathers/husbands name' || // Handle user's format approximately
              (lowerKey.includes('father') && lowerKey.includes('husband'))
            ) {
              normalizedRecord.fatherHusbandName = record[key];
            } else if (
              lowerKey === 'attendance id' ||
              lowerKey === 'attendence id' // Handle typo 'attendence'
            ) {
              normalizedRecord.attendanceId = record[key];
            } else if (
              lowerKey === 'cnic number' ||
              lowerKey === 'cnic-number'
            ) {
              normalizedRecord.cnicNumber = record[key];
            } else if (lowerKey === 'gender') {
              normalizedRecord.gender = record[key];
            } else if (lowerKey === 'contact number') {
              normalizedRecord.contactNumber = record[key];
            } else if (lowerKey === 'leaves policy') {
              normalizedRecord.leavesPolicy = record[key];
            } else if (lowerKey === 'working hours policy') {
              normalizedRecord.workingHoursPolicy = record[key];
            } else if (lowerKey === 'branch' || lowerKey === 'location') {
              normalizedRecord.branch = record[key];
            } else if (lowerKey === 'allocation') {
              normalizedRecord.allocation = record[key];
            } else if (lowerKey === 'employee id' || lowerKey === 'employee-id') {
              normalizedRecord.employeeId = record[key];
            } else if (
              lowerKey === 'current address' ||
              lowerKey === 'current-address' ||
              lowerKey === 'currentaddress'
            ) {
              normalizedRecord.currentAddress = record[key];
            } else if (
              lowerKey === 'permanent address' ||
              lowerKey === 'permanent-address' ||
              lowerKey === 'permanentaddress'
            ) {
              normalizedRecord.permanentAddress = record[key];
            } else if (lowerKey === 'address') {
              // If there's a single "ADDRESS" column, map it to currentAddress
              // If currentAddress already exists, map to permanentAddress
              if (!normalizedRecord.currentAddress) {
                normalizedRecord.currentAddress = record[key];
              } else if (!normalizedRecord.permanentAddress) {
                normalizedRecord.permanentAddress = record[key];
              }
            }
          }

          // Assign normalized fields to record if missing
          Object.assign(record, normalizedRecord);

          // Normalize column names with various formats (matching Excel format exactly)
          const employeeId =
            record['Employee ID'] ||
            record['Employee-ID'] ||
            record.EmployeeID ||
            record.employeeId;
          const cnicNumber =
            record['CNIC-Number'] ||
            record['CNIC Number'] ||
            record.CNICNumber ||
            record.cnicNumber;
          const officialEmail =
            record['Offcial-Email'] ||
            record['Official-Email'] ||
            record['Official Email'] ||
            record.OfficialEmail ||
            record.officialEmail;

          // Check if employee already exists by employeeId
          if (employeeId) {
            const existingEmployee = await this.prisma.employee.findUnique({
              where: { employeeId },
            });

            if (existingEmployee) {
              errors.push({
                row: record,
                error: `Employee already exists: ${employeeId}`,
              });
              continue;
            }
          }

          // Check if CNIC already exists
          if (cnicNumber) {
            const existingCNIC = await this.prisma.employee.findUnique({
              where: { cnicNumber },
            });

            if (existingCNIC) {
              errors.push({
                row: record,
                error: `CNIC already exists: ${cnicNumber}`,
              });
              continue;
            }
          }

          // Check if official email already exists
          if (officialEmail) {
            const existingEmail = await this.prisma.employee.findUnique({
              where: { officialEmail },
            });

            if (existingEmail) {
              errors.push({
                row: record,
                error: `Official email already exists: ${officialEmail}`,
              });
              continue;
            }
          }

          // Parse selected equipments - only if column exists and has value
          const selectedEquipments =
            record.SelectedEquipments ||
            record.selectedEquipments ||
            record['Selected Equipments'] ||
            record['Selected-Equipments'] ||
            '';
          // Filter out empty strings and only process if we have actual equipment names/IDs
          const equipmentList =
            selectedEquipments && selectedEquipments.trim()
              ? selectedEquipments
                .split(',')
                .map((e: string) => e.trim())
                .filter((e: string) => e.length > 0)
              : [];

          // Validate required fields
          if (!employeeId) {
            errors.push({ row: record, error: 'Employee ID is required' });
            continue;
          }
          if (!cnicNumber) {
            errors.push({ row: record, error: 'CNIC Number is required' });
            continue;
          }


          // Get reporting manager with fallback
          const reportingManager =
            record.ReportingManager ||
            record.reportingManager ||
            record['Reporting Manager'] ||
            record['Reporting-Manager'] ||
            'N/A';

          // Get bank details with fallback
          const bankName =
            record.BankName ||
            record.bankName ||
            record['Bank Name'] ||
            record['Bank-Name'] ||
            'N/A';
          const accountNumber =
            record.AccountNumber ||
            record.accountNumber ||
            record['Account Number'] ||
            record['Account-Number'] ||
            'N/A';
          const accountTitle =
            record.AccountTitle ||
            record.accountTitle ||
            record['Account Title'] ||
            record['Account-Title'] ||
            record['Employee Name'] ||
            record.EmployeeName ||
            record.employeeName ||
            'N/A';

          // Parse dates
          const joiningDateStr =
            record['Joining-Date'] ||
            record['Joining Date'] ||
            record.JoiningDate ||
            record.joiningDate;
          const dateOfBirthStr =
            record['Date of Birth'] ||
            record['Date Of Birth'] ||
            record['Date-of-Birth'] ||
            record.DateOfBirth ||
            record.dateOfBirth;
          const joiningDate = this.parseDate(joiningDateStr);
          const dateOfBirth = this.parseDate(dateOfBirthStr);

          // Validate required date fields only if they are provided
          if (joiningDateStr && !joiningDate) {
            errors.push({
              row: record,
              error: `Invalid Joining Date format: ${joiningDateStr}`,
            });
            continue;
          }
          // Do not enforce dateOfBirth requirement
          if (dateOfBirthStr && !dateOfBirth) {
            errors.push({
              row: record,
              error: `Invalid Date of Birth format: ${dateOfBirthStr}`,
            });
            continue;
          }

          // Resolve entity names to IDs
          let departmentId: string;
          let subDepartmentId: string | null = null;
          let designationId: string;
          let employeeGradeId: string;
          let maritalStatusId: string | null = null;
          let employmentStatusId: string | undefined;
          let countryId: string | null = null;
          let stateId: string | null = null;
          let cityId: string | null = null;
          let locationId: string | null = null;
          // ... (lines 2820-2986 omitted for brevity but they don't contain 'branch')
          // ... (Wait, I should include the actual lines if I want to replace precisely)
          let workingHoursPolicyId: string;
          let leavesPolicyId: string;

          try {
            // Resolve department
            const departmentName = record.Department || record.department;
            if (!departmentName) {
              errors.push({ row: record, error: 'Department is required' });
              continue;
            }
            departmentId = await this.findOrCreateDepartment(
              departmentName,
              ctx,
            );

            // Resolve sub-department (optional)
            const subDepartmentName =
              record['Sub Department'] ||
              record['Sub-Department'] ||
              record.SubDepartment ||
              record.subDepartment;
            if (subDepartmentName) {
              subDepartmentId = await this.findOrCreateSubDepartment(
                subDepartmentName,
                departmentId,
                ctx,
              );
            }

            // Resolve designation
            const designationName = record.Designation || record.designation;
            if (!designationName) {
              errors.push({ row: record, error: 'Designation is required' });
              continue;
            }
            designationId = await this.findOrCreateDesignation(
              designationName,
              ctx,
            );

            // Resolve employee grade
            const employeeGradeName =
              record['Employee-Grade'] ||
              record['Employee Grade'] ||
              record.EmployeeGrade ||
              record.employeeGrade;
            if (!employeeGradeName) {
              errors.push({ row: record, error: 'Employee Grade is required' });
              continue;
            }
            employeeGradeId = await this.findOrCreateEmployeeGrade(
              employeeGradeName,
              ctx,
            );

            // Resolve marital status (optional)
            const maritalStatusName =
              record['Marital Status'] ||
              record['Marital-Status'] ||
              record.MaritalStatus ||
              record.maritalStatus;
            if (maritalStatusName) {
              maritalStatusId = await this.findOrCreateMaritalStatus(
                maritalStatusName,
                ctx,
              );
            }

            // Resolve employment status
            const employmentStatusName =
              record['Employment Status'] ||
              record['Employment-Status'] ||
              record.EmploymentStatus ||
              record.employmentStatus;

            if (employmentStatusName) {
              employmentStatusId = await this.findOrCreateEmploymentStatus(
                employmentStatusName,
                ctx,
              );
            }

            // Resolve country, state, city
            const countryName = record.Country || record.country;
            const stateName =
              record.State ||
              record.Province ||
              record.province ||
              record.state;

            // Try to resolve country
            if (countryName && countryName.trim() !== '') {
              countryId = await this.findCountryByName(countryName);
              if (!countryId) {
                // Sample countries omitted for brevity, adding logic to try state inference if country not found by name? 
                // Actually if name is provided but invalid, we should error.
                // But let's stick to the current logic which errors.
                // Re-implementing the error reporting roughly as it was but simpler.
                errors.push({
                  row: record,
                  error: `Country not found: "${countryName}"`,
                });
                continue;
              }
            } else if (stateName && stateName.trim() !== '') {
              // Try to infer country from state
              const state = await this.prisma.state.findFirst({
                where: { name: stateName },
              });

              if (state) {
                countryId = state.countryId;
                stateId = state.id;
              } else {
                // If state is also not found, we can't do anything
                errors.push({ row: record, error: 'Country is required and could not be inferred from State' });
                continue;
              }
            } else {
              errors.push({ row: record, error: 'Country is required' });
              continue;
            }

            if (!stateName || stateName.trim() === '') {
              errors.push({ row: record, error: 'State/Province is required' });
              continue;
            }

            // If we inferred countryId, we can find state checking countryId, or we already found it.
            // But findStateByName usually takes countryId.
            // If we found `state` directly above, we already have `state.id`.

            if (!stateId) {
              stateId = await this.findStateByName(stateName, countryId!);
            }

            if (!stateId) {
              const sampleStates = await this.prisma.state.findMany({
                where: { countryId },
                take: 5,
                select: { name: true },
              });
              errors.push({
                row: record,
                error: `State/Province not found: "${stateName}" in country "${countryName}". Available states: ${sampleStates.map((s) => s.name).join(', ') || 'None'}`,
              });
              continue;
            }

            const cityName = record.City || record.city;
            if (!cityName || cityName.trim() === '') {
              errors.push({ row: record, error: 'City is required' });
              continue;
            }

            cityId = await this.findCityByName(cityName, stateId);

            if (!cityId) {
              const sampleCities = await this.prisma.city.findMany({
                where: { stateId },
                take: 5,
                select: { name: true },
              });
              errors.push({
                row: record,
                error: `City not found: "${cityName}" in state "${stateName}". Available cities: ${sampleCities.map((c) => c.name).join(', ') || 'None'}`,
              });
              continue;
            }

            // Final validation
            if (!countryId || !stateId || !cityId) {
              errors.push({
                row: record,
                error:
                  'Country, State, and City are required and must be valid',
              });
              continue;
            }

            // Resolve branch/location (optional)
            const branchName = record.Branch || record.branch;
            if (branchName) {
              locationId = await this.findOrCreateLocation(branchName, ctx);
            }

            // Resolve working hours policy
            const workingHoursPolicyName =
              record['Working-Hours-Policy'] ||
              record['Working Hours Policy'] ||
              record.WorkingHoursPolicy ||
              record.workingHoursPolicy;
            if (!workingHoursPolicyName) {
              errors.push({
                row: record,
                error: 'Working Hours Policy is required',
              });
              continue;
            }
            workingHoursPolicyId = await this.findOrCreateWorkingHoursPolicy(
              workingHoursPolicyName,
              ctx,
            );

            // Resolve leaves policy
            const leavesPolicyName =
              record['Leaves-Policy'] ||
              record['Leaves Policy'] ||
              record.LeavesPolicy ||
              record.leavesPolicy;
            if (!leavesPolicyName) {
              errors.push({ row: record, error: 'Leaves Policy is required' });
              continue;
            }
            leavesPolicyId = await this.findOrCreateLeavesPolicy(
              leavesPolicyName,
              ctx,
            );
          } catch (error: any) {
            errors.push({
              row: record,
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }

          const result = await this.create(
            {
              employeeId: employeeId,
              employeeName:
                record['Employee Name'] ||
                record['Employee-Name'] ||
                record.EmployeeName ||
                record.employeeName,
              fatherHusbandName:
                record['Father / Husband Name'] ||
                record['Father/Husband Name'] ||
                record['Father-Husband-Name'] ||
                record.FatherHusbandName ||
                record.fatherHusbandName,
              department: departmentId,
              subDepartment: subDepartmentId,
              employeeGrade: employeeGradeId,
              attendanceId:
                record['Attendance-ID'] ||
                record['Attendance ID'] ||
                record.AttendanceID ||
                record.attendanceId,
              designation: designationId,
              maritalStatus: maritalStatusId,
              employmentStatus: employmentStatusId,
              probationExpiryDate:
                record['Probation Expiry Date'] ||
                record['Probation-Expiry-Date'] ||
                record.ProbationExpiryDate ||
                record.probationExpiryDate ||
                null,
              cnicNumber: cnicNumber,
              cnicExpiryDate:
                record['CNIC Expiry Date'] ||
                record['CNIC-Expiry-Date'] ||
                record.CNICExpiryDate ||
                record.cnicExpiryDate ||
                null,
              lifetimeCnic:
                record['Lifetime CNIC'] === 'true' ||
                record['Lifetime-CNIC'] === 'true' ||
                record.LifetimeCNIC === 'true' ||
                record.lifetimeCnic === 'true' ||
                false,
              joiningDate: joiningDate ? joiningDate.toISOString() : null,
              dateOfBirth: dateOfBirth ? dateOfBirth.toISOString() : null,
              nationality: record.Nationality || record.nationality,
              gender: record.Gender || record.gender,
              contactNumber:
                record['Contact-Number'] ||
                record['Contact Number'] ||
                record.ContactNumber ||
                record.contactNumber,
              emergencyContactNumber:
                record.EmergencyContactNumber ||
                record.emergencyContactNumber ||
                record['Emergency Contact Number'] ||
                record['Emergency-Contact-Number'] ||
                null,
              emergencyContactPersonName:
                record.EmergencyContactPerson ||
                record.emergencyContactPerson ||
                record['Emergency Contact Person'] ||
                record['Emergency-Contact-Person'] ||
                null,
              personalEmail:
                record.PersonalEmail ||
                record.personalEmail ||
                record['Personal Email'] ||
                record['Personal-Email'] ||
                null,
              officialEmail: officialEmail,
              country: countryId,
              state: stateId,
              city: cityId,
              area: record.Area || record.area || null,
              employeeSalary: (
                record['Employee-Salary(Compensation)'] ||
                record['Employee-Salary'] ||
                record['Employee Salary'] ||
                record.EmployeeSalary ||
                record.employeeSalary ||
                '0'
              ).toString().replace(/,/g, ''),
              eobi: record.EOBI === 'true' || record.eobi === 'true' || false,
              eobiNumber:
                record['EOBI Number'] ||
                record['EOBI-Number'] ||
                record.EOBINumber ||
                record.eobiNumber ||
                null,
              providentFund:
                record['Provident Fund'] === 'true' ||
                record['Provident-Fund'] === 'true' ||
                record.ProvidentFund === 'true' ||
                record.providentFund === 'true' ||
                false,
              overtimeApplicable:
                record['Overtime Applicable'] === 'true' ||
                record['Overtime-Applicable'] === 'true' ||
                record.OvertimeApplicable === 'true' ||
                record.overtimeApplicable === 'true' ||
                false,
              daysOff:
                record['Days Off'] ||
                record['Days-Off'] ||
                record.DaysOff ||
                record.daysOff ||
                null,
              reportingManager: reportingManager,
              workingHoursPolicy: workingHoursPolicyId,
              location: locationId,
              leavesPolicy: leavesPolicyId,
              allocation: record.Allocation || record.allocation,
              allowRemoteAttendance:
                record.AllowRemoteAttendance === 'true' ||
                record.allowRemoteAttendance === 'true' ||
                record['Allow Remote Attendance'] === 'true' ||
                record['Allow-Remote-Attendance'] === 'true' ||
                false,
              currentAddress:
                record.currentAddress ||
                record.CurrentAddress ||
                record['Current Address'] ||
                record['Current-Address'] ||
                record['ADDRESS'] ||
                record.Address ||
                null,
              permanentAddress:
                record.permanentAddress ||
                record.PermanentAddress ||
                record['Permanent Address'] ||
                record['Permanent-Address'] ||
                null,
              bankName: bankName,
              accountNumber: accountNumber,
              accountTitle: accountTitle,
              accountType:
                record.AccountType ||
                record.accountType ||
                record['Account Type'] ||
                record['Account-Type'] ||
                null,
              password: record.Password || record.password || null,
              roles: record.Roles || record.roles || null,
              selectedEquipments:
                equipmentList.length > 0 ? equipmentList : undefined,
              status: record.Status || record.status || 'active',
            },
            ctx,
          );

          if (result.status) {
            results.push(result.data);
          } else {
            errors.push({
              row: record,
              error: result.message || 'Failed to create employee',
            });
          }
        } catch (error: any) {
          errors.push({
            row: record,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'bulk_upload',
        module: 'employees',
        entity: 'Employee',
        description: `Bulk uploaded ${results.length} employees from ${fileExtension === '.xlsx' ? 'Excel' : 'CSV'} file`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: errors.length === 0 ? 'success' : 'failure',
      });

      return {
        status: errors.length === 0,
        data: results,
        errors: errors.length > 0 ? errors : undefined,
        message:
          errors.length > 0
            ? `${results.length} records imported, ${errors.length} failed`
            : `${results.length} records imported successfully`,
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'bulk_upload',
        module: 'employees',
        entity: 'Employee',
        description: 'Failed to bulk upload employees',
        errorMessage: error instanceof Error ? error.message : String(error),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
