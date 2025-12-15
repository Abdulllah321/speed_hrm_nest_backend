import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class EmployeeService {
  constructor(private prisma: PrismaService, private activityLogs: ActivityLogsService) {}

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
    })
    
    // Map to include names for compatibility
    const mappedEmployees = employees.map((emp: any) => ({
      ...emp,
      department: emp.department?.name || emp.departmentId,
      subDepartment: emp.subDepartment?.name || emp.subDepartmentId,
      designation: emp.designation?.name || emp.designationId,
    }))
    
    return { status: true, data: mappedEmployees }
  }

  async get(id: string) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { id },
      include: {
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
        branch: {
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
        qualifications: {
          include: {
            institute: {
              select: {
                id: true,
                name: true,
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
          },
        },
      },
    })
    if (!employee) return { status: false, message: 'Employee not found' }
    
    // Map relations to IDs for form compatibility, while keeping relation objects
    const mappedEmployee = {
      ...employee,
      department: employee.department?.id || employee.departmentId,
      subDepartment: employee.subDepartment?.id || employee.subDepartmentId || null,
      employeeGrade: employee.employeeGrade?.id || employee.employeeGradeId,
      designation: employee.designation?.id || employee.designationId,
      maritalStatus: employee.maritalStatus?.id || employee.maritalStatusId,
      employmentStatus: employee.employmentStatus?.id || employee.employmentStatusId,
      country: employee.country?.id || employee.countryId,
      state: employee.state?.id || employee.stateId,
      province: employee.state?.id || employee.stateId, // Alias for compatibility
      city: employee.city?.id || employee.cityId,
      workingHoursPolicy: employee.workingHoursPolicy?.id || employee.workingHoursPolicyId,
      branch: employee.branch?.id || employee.branchId,
      leavesPolicy: employee.leavesPolicy?.id || employee.leavesPolicyId,
      // Explicitly preserve address fields
      currentAddress: employee.currentAddress ?? null,
      permanentAddress: employee.permanentAddress ?? null,
      // Keep relation objects for display purposes
      departmentRelation: employee.department,
      subDepartmentRelation: employee.subDepartment,
      employeeGradeRelation: employee.employeeGrade,
      designationRelation: employee.designation,
      maritalStatusRelation: employee.maritalStatus,
      employmentStatusRelation: employee.employmentStatus,
      countryRelation: employee.country,
      stateRelation: employee.state,
      cityRelation: employee.city,
      workingHoursPolicyRelation: employee.workingHoursPolicy,
      branchRelation: employee.branch,
      leavesPolicyRelation: employee.leavesPolicy,
    }
    
    return { status: true, data: mappedEmployee }
  }

  async create(body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      // Debug logging
      console.log('🔍 Employee create called with body:', {
        employeeId: body.employeeId,
        employeeName: body.employeeName,
        department: body.department,
        country: body.country,
        state: body.state,
        city: body.city,
        branch: body.branch,
        workingHoursPolicy: body.workingHoursPolicy,
        leavesPolicy: body.leavesPolicy,
      })

      // Helper function to check if string is UUID
      const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)

      // Validate required foreign key fields
      if (!body.department) {
        throw new Error('Department is required')
      }
      if (!body.employeeGrade) {
        throw new Error('Employee Grade is required')
      }
      if (!body.designation) {
        throw new Error('Designation is required')
      }
      if (!body.maritalStatus) {
        throw new Error('Marital Status is required')
      }
      if (!body.employmentStatus) {
        throw new Error('Employment Status is required')
      }
      if (!body.country) {
        throw new Error('Country is required')
      }
      if (!body.state) {
        throw new Error('State is required')
      }
      if (!body.city) {
        throw new Error('City is required')
      }
      if (!body.branch) {
        throw new Error('Branch is required')
      }
      if (!body.workingHoursPolicy) {
        throw new Error('Working Hours Policy is required')
      }
      if (!body.leavesPolicy) {
        throw new Error('Leaves Policy is required')
      }

      // Resolve department (handle both ID and name)
      if (!isUUID(body.department)) {
        console.log('🔄 Resolving department name to ID:', body.department)
        body.department = await this.findOrCreateDepartment(body.department, ctx)
      }

      // Resolve sub-department if provided (handle both ID and name)
      if (body.subDepartment && !isUUID(body.subDepartment)) {
        console.log('🔄 Resolving sub-department name to ID:', body.subDepartment)
        body.subDepartment = await this.findOrCreateSubDepartment(body.subDepartment, body.department, ctx)
      }

      // Resolve designation (handle both ID and name)
      if (!isUUID(body.designation)) {
        console.log('🔄 Resolving designation name to ID:', body.designation)
        body.designation = await this.findOrCreateDesignation(body.designation, ctx)
      }

      // Resolve employee grade (handle both ID and name)
      if (!isUUID(body.employeeGrade)) {
        console.log('🔄 Resolving employee grade to ID:', body.employeeGrade)
        body.employeeGrade = await this.findOrCreateEmployeeGrade(body.employeeGrade, ctx)
      }

      // Resolve marital status (handle both ID and name)
      if (!isUUID(body.maritalStatus)) {
        console.log('🔄 Resolving marital status name to ID:', body.maritalStatus)
        body.maritalStatus = await this.findOrCreateMaritalStatus(body.maritalStatus, ctx)
      }

      // Resolve employment status (handle both ID and name)
      if (!isUUID(body.employmentStatus)) {
        console.log('🔄 Resolving employment status to ID:', body.employmentStatus)
        body.employmentStatus = await this.findOrCreateEmploymentStatus(body.employmentStatus, ctx)
      }

      // Resolve branch (handle both ID and name)
      if (!isUUID(body.branch)) {
        console.log('🔄 Resolving branch name to ID:', body.branch)
        body.branch = await this.findOrCreateBranch(body.branch, ctx)
      }

      // Resolve working hours policy (handle both ID and name)
      if (!isUUID(body.workingHoursPolicy)) {
        console.log('🔄 Resolving working hours policy name to ID:', body.workingHoursPolicy)
        body.workingHoursPolicy = await this.findOrCreateWorkingHoursPolicy(body.workingHoursPolicy, ctx)
      }

      // Resolve leaves policy (handle both ID and name)
      if (!isUUID(body.leavesPolicy)) {
        console.log('🔄 Resolving leaves policy name to ID:', body.leavesPolicy)
        body.leavesPolicy = await this.findOrCreateLeavesPolicy(body.leavesPolicy, ctx)
      }

      // Resolve country, state, city - handle both IDs and names
      let countryId = body.country
      let stateId = body.state
      let cityId = body.city
      
      console.log('🔍 Processing country:', body.country, 'Is UUID?', isUUID(body.country))
      
      if (!isUUID(body.country)) {
        // It's a name, resolve to ID
        console.log('🔄 Resolving country name to ID:', body.country)
        countryId = await this.findCountryByName(body.country)
        if (!countryId) {
          throw new Error(`Country not found: ${body.country}`)
        }
        console.log('✅ Country resolved to ID:', countryId)
      } else {
        // Verify the UUID exists
        const countryExists = await this.prisma.country.findUnique({ where: { id: body.country } })
        if (!countryExists) {
          throw new Error(`Country with ID ${body.country} does not exist in database`)
        }
      }

      console.log('🔍 Processing state:', body.state, 'Is UUID?', isUUID(body.state))
      
      if (!isUUID(body.state)) {
        // It's a name, resolve to ID
        console.log('🔄 Resolving state name to ID:', body.state)
        stateId = await this.findStateByName(body.state, countryId)
        if (!stateId) {
          throw new Error(`State not found: ${body.state}`)
        }
        console.log('✅ State resolved to ID:', stateId)
      } else {
        // Verify the UUID exists
        const stateExists = await this.prisma.state.findUnique({ where: { id: body.state } })
        if (!stateExists) {
          throw new Error(`State with ID ${body.state} does not exist in database`)
        }
      }

      console.log('🔍 Processing city:', body.city, 'Is UUID?', isUUID(body.city))
      
      if (!isUUID(body.city)) {
        // It's a name, resolve to ID
        console.log('🔄 Resolving city name to ID:', body.city)
        cityId = await this.findCityByName(body.city, stateId)
        if (!cityId) {
          throw new Error(`City not found: ${body.city}`)
        }
        console.log('✅ City resolved to ID:', cityId)
      } else {
        // Verify the UUID exists
        const cityExists = await this.prisma.city.findUnique({ where: { id: body.city } })
        if (!cityExists) {
          throw new Error(`City with ID ${body.city} does not exist in database`)
        }
      }

      console.log('✅ All foreign key validations passed, creating employee...')

      // Update body with resolved IDs
      body.country = countryId
      body.state = stateId
      body.city = cityId

      const created = await this.prisma.employee.create({
        data: {
          employeeId: body.employeeId,
          employeeName: body.employeeName,
          fatherHusbandName: body.fatherHusbandName,
          departmentId: body.department,
          subDepartmentId: body.subDepartment ?? null,
          employeeGradeId: body.employeeGrade,
          attendanceId: body.attendanceId,
          designationId: body.designation,
          maritalStatusId: body.maritalStatus,
          employmentStatusId: body.employmentStatus,
          probationExpiryDate: body.probationExpiryDate ? new Date(body.probationExpiryDate) : null,
          cnicNumber: body.cnicNumber,
          cnicExpiryDate: body.cnicExpiryDate ? new Date(body.cnicExpiryDate) : null,
          lifetimeCnic: !!body.lifetimeCnic,
          joiningDate: new Date(body.joiningDate),
          dateOfBirth: new Date(body.dateOfBirth),
          nationality: body.nationality,
          gender: body.gender,
          contactNumber: body.contactNumber,
          emergencyContactNumber: body.emergencyContactNumber ?? null,
          emergencyContactPerson: body.emergencyContactPersonName ?? null,
          personalEmail: body.personalEmail ?? null,
          officialEmail: body.officialEmail,
          countryId: body.country,
          stateId: body.state,
          cityId: body.city,
          area: body.area ?? null,
          employeeSalary: body.employeeSalary as any,
          eobi: !!body.eobi,
          eobiNumber: body.eobiNumber ?? null,
          providentFund: !!body.providentFund,
          overtimeApplicable: !!body.overtimeApplicable,
          daysOff: body.daysOff ?? null,
          reportingManager: body.reportingManager,
          workingHoursPolicyId: body.workingHoursPolicy,
          branchId: body.branch,
          leavesPolicyId: body.leavesPolicy,
          allowRemoteAttendance: !!body.allowRemoteAttendance,
          currentAddress: body.currentAddress ?? null,
          permanentAddress: body.permanentAddress ?? null,
          bankName: body.bankName,
          accountNumber: body.accountNumber,
          accountTitle: body.accountTitle,
          status: 'active',
          equipmentAssignments: body.selectedEquipments && Array.isArray(body.selectedEquipments) && body.selectedEquipments.length > 0
            ? {
                create: body.selectedEquipments.map((equipmentId: string) => ({
                  equipmentId,
                  assignedById: ctx.userId,
                  status: 'assigned',
                })),
              }
            : undefined,
          qualifications: body.qualifications && Array.isArray(body.qualifications) && body.qualifications.length > 0
            ? {
                create: body.qualifications.map((q: any) => ({
                  qualificationId: q.qualification || q.qualificationId || '',
                  instituteId: q.instituteId || null,
                  countryId: q.countryId || null,
                  cityId: q.cityId || null,
                  stateId: q.stateId || null,
                  year: q.year ? parseInt(q.year) : null,
                  grade: q.grade || null,
                })),
              }
            : undefined,
        },
      })

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
      })
      return { status: true, data: created }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'employees',
        entity: 'Employee',
        description: 'Failed to create employee',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      console.error('Employee create error:', error)
      return { status: false, message: error?.message || 'Failed to create employee' }
    }
  }

  async update(id: string, body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.employee.findUnique({ where: { id } })
      
      // Handle qualifications update
      if (body.qualifications !== undefined) {
        // Delete existing qualifications
        await this.prisma.employeeQualification.deleteMany({
          where: { employeeId: id },
        })
      }

      // Handle equipment assignments update
      if (body.selectedEquipments !== undefined) {
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
        })
      }

      const updated = await this.prisma.employee.update({
        where: { id },
        data: {
          employeeName: body.employeeName ?? existing?.employeeName,
          fatherHusbandName: body.fatherHusbandName ?? existing?.fatherHusbandName,
          departmentId: body.department ?? existing?.departmentId,
          subDepartmentId: body.subDepartment ?? existing?.subDepartmentId,
          employeeGradeId: body.employeeGrade ?? existing?.employeeGradeId,
          attendanceId: body.attendanceId ?? existing?.attendanceId,
          designationId: body.designation ?? existing?.designationId,
          maritalStatusId: body.maritalStatus ?? existing?.maritalStatusId,
          employmentStatusId: body.employmentStatus ?? existing?.employmentStatusId,
          probationExpiryDate: body.probationExpiryDate ? new Date(body.probationExpiryDate) : existing?.probationExpiryDate ?? null,
          cnicNumber: body.cnicNumber ?? existing?.cnicNumber,
          cnicExpiryDate: body.cnicExpiryDate ? new Date(body.cnicExpiryDate) : existing?.cnicExpiryDate ?? null,
          lifetimeCnic: body.lifetimeCnic ?? existing?.lifetimeCnic,
          joiningDate: body.joiningDate ? new Date(body.joiningDate) : existing?.joiningDate,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : existing?.dateOfBirth,
          nationality: body.nationality ?? existing?.nationality,
          gender: body.gender ?? existing?.gender,
          contactNumber: body.contactNumber ?? existing?.contactNumber,
          emergencyContactNumber: body.emergencyContactNumber ?? existing?.emergencyContactNumber,
          emergencyContactPerson: body.emergencyContactPersonName ?? existing?.emergencyContactPerson,
          personalEmail: body.personalEmail ?? existing?.personalEmail,
          officialEmail: body.officialEmail ?? existing?.officialEmail,
          countryId: body.country ?? existing?.countryId,
          stateId: body.state ?? existing?.stateId,
          cityId: body.city ?? existing?.cityId,
          area: body.area ?? existing?.area,
          employeeSalary: body.employeeSalary !== undefined ? (body.employeeSalary as any) : existing?.employeeSalary,
          eobi: body.eobi ?? existing?.eobi,
          eobiNumber: body.eobiNumber ?? existing?.eobiNumber,
          providentFund: body.providentFund ?? existing?.providentFund,
          overtimeApplicable: body.overtimeApplicable ?? existing?.overtimeApplicable,
          daysOff: body.daysOff ?? existing?.daysOff,
          reportingManager: body.reportingManager ?? existing?.reportingManager,
          workingHoursPolicyId: body.workingHoursPolicy ?? existing?.workingHoursPolicyId,
          branchId: body.branch ?? existing?.branchId,
          leavesPolicyId: body.leavesPolicy ?? existing?.leavesPolicyId,
          allowRemoteAttendance: body.allowRemoteAttendance ?? existing?.allowRemoteAttendance,
          currentAddress: body.currentAddress ?? existing?.currentAddress,
          permanentAddress: body.permanentAddress ?? existing?.permanentAddress,
          bankName: body.bankName ?? existing?.bankName,
          accountNumber: body.accountNumber ?? existing?.accountNumber,
          accountTitle: body.accountTitle ?? existing?.accountTitle,
          status: body.status ?? existing?.status,
          equipmentAssignments: body.selectedEquipments !== undefined && Array.isArray(body.selectedEquipments) && body.selectedEquipments.length > 0
            ? {
                create: body.selectedEquipments.map((equipmentId: string) => ({
                  equipmentId,
                  assignedById: ctx.userId,
                  status: 'assigned',
                })),
              }
            : undefined,
          qualifications: body.qualifications !== undefined && Array.isArray(body.qualifications) && body.qualifications.length > 0
            ? {
                create: body.qualifications.map((q: any) => ({
                  qualificationId: q.qualification || q.qualificationId || '',
                  instituteId: q.instituteId || null,
                  countryId: q.countryId || null,
                  cityId: q.cityId || null,
                  stateId: q.stateId || null,
                  year: q.year ? parseInt(q.year) : null,
                  grade: q.grade || null,
                })),
              }
            : undefined,
        },
      })

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
      })
      return { status: true, data: updated, message: 'Employee updated successfully' }
    } catch (error: any) {
      console.error('Employee update error:', error)
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        description: 'Failed to update employee',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: error?.message || 'Failed to update employee' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.employee.findUnique({ where: { id } })
      const removed = await this.prisma.employee.delete({ where: { id } })
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
      })
      return { status: true, data: removed }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        description: 'Failed to delete employee',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete employee' }
    }
  }

  /**
   * Helper function to find or create department by name
   */
  private async findOrCreateDepartment(name: string, ctx: { userId?: string }): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Department name is required')
    }
    const trimmedName = name.trim()
    
    // Try to find existing department
    let department = await this.prisma.department.findUnique({
      where: { name: trimmedName },
    })
    
    // If not found, create it
    if (!department) {
      department = await this.prisma.department.create({
        data: {
          name: trimmedName,
          createdById: ctx.userId || null,
        },
      })
    }
    
    return department.id
  }

  /**
   * Helper function to find or create sub-department by name within a department
   */
  private async findOrCreateSubDepartment(name: string, departmentId: string, ctx: { userId?: string }): Promise<string | null> {
    if (!name || name.trim() === '') {
      return null
    }
    const trimmedName = name.trim()
    
    // Try to find existing sub-department
    let subDepartment = await this.prisma.subDepartment.findFirst({
      where: {
        name: trimmedName,
        departmentId: departmentId,
      },
    })
    
    // If not found, create it
    if (!subDepartment) {
      subDepartment = await this.prisma.subDepartment.create({
        data: {
          name: trimmedName,
          departmentId: departmentId,
          createdById: ctx.userId || null,
        },
      })
    }
    
    return subDepartment.id
  }

  /**
   * Helper function to find or create designation by name
   */
  private async findOrCreateDesignation(name: string, ctx: { userId?: string }): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Designation name is required')
    }
    const trimmedName = name.trim()
    
    let designation = await this.prisma.designation.findUnique({
      where: { name: trimmedName },
    })
    
    if (!designation) {
      designation = await this.prisma.designation.create({
        data: {
          name: trimmedName,
          createdById: ctx.userId || null,
        },
      })
    }
    
    return designation.id
  }

  /**
   * Helper function to find or create employee grade by grade
   */
  private async findOrCreateEmployeeGrade(grade: string, ctx: { userId?: string }): Promise<string> {
    if (!grade || grade.trim() === '') {
      throw new Error('Employee grade is required')
    }
    const trimmedGrade = grade.trim()
    
    let employeeGrade = await this.prisma.employeeGrade.findUnique({
      where: { grade: trimmedGrade },
    })
    
    if (!employeeGrade) {
      employeeGrade = await this.prisma.employeeGrade.create({
        data: {
          grade: trimmedGrade,
          createdById: ctx.userId || null,
        },
      })
    }
    
    return employeeGrade.id
  }

  /**
   * Helper function to find or create marital status by name
   */
  private async findOrCreateMaritalStatus(name: string, ctx: { userId?: string }): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Marital status is required')
    }
    const trimmedName = name.trim()
    
    let maritalStatus = await this.prisma.maritalStatus.findUnique({
      where: { name: trimmedName },
    })
    
    if (!maritalStatus) {
      maritalStatus = await this.prisma.maritalStatus.create({
        data: {
          name: trimmedName,
          createdById: ctx.userId || null,
        },
      })
    }
    
    return maritalStatus.id
  }

  /**
   * Helper function to find or create employment status by status
   */
  private async findOrCreateEmploymentStatus(status: string, ctx: { userId?: string }): Promise<string> {
    if (!status || status.trim() === '') {
      throw new Error('Employment status is required')
    }
    const trimmedStatus = status.trim()
    
    let employmentStatus = await this.prisma.employeeStatus.findUnique({
      where: { status: trimmedStatus },
    })
    
    if (!employmentStatus) {
      employmentStatus = await this.prisma.employeeStatus.create({
        data: {
          status: trimmedStatus,
          createdById: ctx.userId || null,
        },
      })
    }
    
    return employmentStatus.id
  }

  /**
   * Helper function to find country by name
   */
  private async findCountryByName(name: string): Promise<string | null> {
    if (!name || name.trim() === '') {
      return null
    }
    const trimmedName = name.trim()
    
    // Common country name mappings
    const countryMappings: Record<string, string> = {
      'pakistan': 'Pakistan',
      'india': 'India',
      'bangladesh': 'Bangladesh',
      'sri lanka': 'Sri Lanka',
      'nepal': 'Nepal',
      'afghanistan': 'Afghanistan',
      'united states': 'United States',
      'usa': 'United States',
      'uk': 'United Kingdom',
      'united kingdom': 'United Kingdom',
    }
    
    // Try mapped name first
    const mappedName = countryMappings[trimmedName.toLowerCase()]
    const searchName = mappedName || trimmedName
    
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
    })
    
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
      })
    }
    
    return country?.id || null
  }

  /**
   * Helper function to find state by name and country
   */
  private async findStateByName(name: string, countryId: string): Promise<string | null> {
    if (!name || name.trim() === '' || !countryId) {
      return null
    }
    const trimmedName = name.trim()
    
    // Common state/province name mappings for Pakistan
    const stateMappings: Record<string, string> = {
      'sindh': 'Sindh',
      'punjab': 'Punjab',
      'khyber pakhtunkhwa': 'Khyber Pakhtunkhwa',
      'kpk': 'Khyber Pakhtunkhwa',
      'balochistan': 'Balochistan',
      'gilgit baltistan': 'Gilgit-Baltistan',
      'gb': 'Gilgit-Baltistan',
    }
    
    const mappedName = stateMappings[trimmedName.toLowerCase()]
    const searchName = mappedName || trimmedName
    
    // Try exact match first
    let state = await this.prisma.state.findFirst({
      where: {
        name: { equals: searchName, mode: 'insensitive' },
        countryId: countryId,
      },
    })
    
    // If not found, try contains search
    if (!state) {
      state = await this.prisma.state.findFirst({
        where: {
          name: { contains: searchName, mode: 'insensitive' },
          countryId: countryId,
        },
      })
    }
    
    // If still not found and we used a mapping, try original name
    if (!state && mappedName) {
      state = await this.prisma.state.findFirst({
        where: {
          OR: [
            { name: { equals: trimmedName, mode: 'insensitive' }, countryId: countryId },
            { name: { contains: trimmedName, mode: 'insensitive' }, countryId: countryId },
          ],
        },
      })
    }
    
    return state?.id || null
  }

  /**
   * Helper function to find city by name, state, and country
   */
  private async findCityByName(name: string, stateId: string): Promise<string | null> {
    if (!name || name.trim() === '' || !stateId) {
      return null
    }
    const trimmedName = name.trim()
    
    // Common city name mappings
    const cityMappings: Record<string, string> = {
      'karachi': 'Karachi',
      'lahore': 'Lahore',
      'islamabad': 'Islamabad',
      'rawalpindi': 'Rawalpindi',
      'faisalabad': 'Faisalabad',
      'multan': 'Multan',
      'peshawar': 'Peshawar',
      'quetta': 'Quetta',
      'hyderabad': 'Hyderabad',
      'sialkot': 'Sialkot',
    }
    
    const mappedName = cityMappings[trimmedName.toLowerCase()]
    const searchName = mappedName || trimmedName
    
    // Try exact match first
    let city = await this.prisma.city.findFirst({
      where: {
        name: { equals: searchName, mode: 'insensitive' },
        stateId: stateId,
      },
    })
    
    // If not found, try contains search
    if (!city) {
      city = await this.prisma.city.findFirst({
        where: {
          name: { contains: searchName, mode: 'insensitive' },
          stateId: stateId,
        },
      })
    }
    
    // If still not found and we used a mapping, try original name
    if (!city && mappedName) {
      city = await this.prisma.city.findFirst({
        where: {
          OR: [
            { name: { equals: trimmedName, mode: 'insensitive' }, stateId: stateId },
            { name: { contains: trimmedName, mode: 'insensitive' }, stateId: stateId },
          ],
        },
      })
    }
    
    return city?.id || null
  }

  /**
   * Helper function to find or create branch by name
   */
  private async findOrCreateBranch(name: string, ctx: { userId?: string }): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Branch name is required')
    }
    const trimmedName = name.trim()
    
    let branch = await this.prisma.branch.findUnique({
      where: { name: trimmedName },
    })
    
    if (!branch) {
      branch = await this.prisma.branch.create({
        data: {
          name: trimmedName,
          createdById: ctx.userId || null,
        },
      })
    }
    
    return branch.id
  }

  /**
   * Helper function to find or create working hours policy by name
   */
  private async findOrCreateWorkingHoursPolicy(name: string, ctx: { userId?: string }): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Working hours policy name is required')
    }
    const trimmedName = name.trim()
    
    let policy = await this.prisma.workingHoursPolicy.findUnique({
      where: { name: trimmedName },
    })
    
    if (!policy) {
      // Create with default values - these should be set properly in production
      policy = await this.prisma.workingHoursPolicy.create({
        data: {
          name: trimmedName,
          startWorkingHours: '09:00',
          endWorkingHours: '18:00',
          createdById: ctx.userId || null,
        },
      })
    }
    
    return policy.id
  }

  /**
   * Helper function to find or create leaves policy by name
   */
  private async findOrCreateLeavesPolicy(name: string, ctx: { userId?: string }): Promise<string> {
    if (!name || name.trim() === '') {
      throw new Error('Leaves policy name is required')
    }
    const trimmedName = name.trim()
    
    let policy = await this.prisma.leavesPolicy.findUnique({
      where: { name: trimmedName },
    })
    
    if (!policy) {
      policy = await this.prisma.leavesPolicy.create({
        data: {
          name: trimmedName,
          createdById: ctx.userId || null,
        },
      })
    }
    
    return policy.id
  }

  /**
   * Helper function to parse various date formats
   */
  private parseDate(dateStr: string): Date | null {
    if (!dateStr || dateStr.trim() === '') return null

    try {
      // Try standard ISO format first
      const isoDate = new Date(dateStr)
      if (!isNaN(isoDate.getTime())) {
        return isoDate
      }

      // Handle DD-MM-YYYY format (27-11-1982)
      if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) {
        const [day, month, year] = dateStr.split('-').map(Number)
        return new Date(year, month - 1, day)
      }

      // Handle MM/DD/YYYY format
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
        const [month, day, year] = dateStr.split('/').map(Number)
        return new Date(year, month - 1, day)
      }

      // Handle formats like "November 11th,2025" or "November 11th, 2025"
      if (/^[A-Za-z]+\s+\d{1,2}(st|nd|rd|th)?,?\s*\d{4}$/.test(dateStr)) {
        // Remove ordinal suffixes (st, nd, rd, th)
        const cleaned = dateStr.replace(/(st|nd|rd|th)/g, '').replace(/,/g, ' ')
        const parsed = new Date(cleaned)
        if (!isNaN(parsed.getTime())) {
          return parsed
        }
      }

      return null
    } catch (error) {
      return null
    }
  }

  /**
   * Bulk upload employees from CSV or Excel file
   * Expected format: EmployeeID,EmployeeName,FatherHusbandName,Department,SubDepartment,EmployeeGrade,AttendanceID,Designation,MaritalStatus,EmploymentStatus,ProbationExpiryDate,CNICNumber,CNICExpiryDate,LifetimeCNIC,JoiningDate,DateOfBirth,Nationality,Gender,ContactNumber,EmergencyContactNumber,EmergencyContactPerson,PersonalEmail,OfficialEmail,Country,Province,City,Area,EmployeeSalary,EOBI,EOBINumber,ProvidentFund,OvertimeApplicable,DaysOff,ReportingManager,WorkingHoursPolicy,Branch,LeavesPolicy,AllowRemoteAttendance,CurrentAddress,PermanentAddress,BankName,AccountNumber,AccountTitle,AccountType,Password,Roles,SelectedEquipments,Status
   */
  async bulkUploadFromCSV(
    filePath: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const fs = await import('fs')
      const path = await import('path')

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error('File not found')
      }

      // Detect file type from extension
      const fileExtension = path.extname(filePath).toLowerCase()
      let records: Array<Record<string, string>>

      if (fileExtension === '.xlsx') {
        // Parse Excel file
        try {
          const XLSX = await import('xlsx')
          
          // Read file buffer
          const fileBuffer = fs.readFileSync(filePath)
          
          // Parse workbook from buffer
          const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
          
          // Get first sheet
          const sheetName = workbook.SheetNames[0]
          if (!sheetName) {
            throw new Error('Excel file has no sheets')
          }

          const worksheet = workbook.Sheets[sheetName]
          
          // Convert to array of arrays (first row is headers)
          const excelData = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '', // Default value for empty cells
            raw: false, // Convert all values to strings
          }) as any[][]

          // Validate we got data
          if (!excelData || excelData.length === 0) {
            throw new Error('Excel file is empty')
          }

          // Convert array of arrays to array of objects (first row is headers)
          const headers = excelData[0] as string[]
          if (!headers || headers.length === 0) {
            throw new Error('Excel file has no header row')
          }

          records = excelData.slice(1).map((row: any[]) => {
            const obj: Record<string, string> = {}
            headers.forEach((header, index) => {
              obj[header] = row[index] ? String(row[index]).trim() : ''
            })
            return obj
          }).filter((row: Record<string, string>) => {
            // Filter out completely empty rows
            return Object.values(row).some(val => val && val.trim().length > 0)
          })
        } catch (error: any) {
          throw new Error(`Failed to parse Excel file: ${error.message}`)
        }
      } else {
        // Parse CSV file
        const { parse } = await import('csv-parse/sync')

        // Read file and validate it's a text file
        let fileContent: string
        try {
          fileContent = fs.readFileSync(filePath, 'utf-8')
        } catch (error: any) {
          throw new Error('Invalid file format. The file appears to be corrupted or not a valid CSV file.')
        }

        // Validate file content is not empty
        if (!fileContent || fileContent.trim().length === 0) {
          throw new Error('The CSV file is empty')
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
          }) as Array<Record<string, string>>
        } catch (parseError: any) {
          throw new Error(`Invalid CSV format: ${parseError.message}`)
        }
      }

      // Validate we got records
      if (!records || records.length === 0) {
        throw new Error('No valid records found in file. Please check the file format.')
      }

      const results: any[] = []
      const errors: Array<{ row: Record<string, string>; error: string }> = []

      for (const record of records) {
        try {
          // Normalize column names with various formats (matching Excel format exactly)
          const employeeId = record['Employee ID'] || record['Employee-ID'] || record.EmployeeID || record.employeeId
          const cnicNumber = record['CNIC-Number'] || record['CNIC Number'] || record.CNICNumber || record.cnicNumber
          const officialEmail = record['Offcial-Email'] || record['Official-Email'] || record['Official Email'] || record.OfficialEmail || record.officialEmail

          // Check if employee already exists by employeeId
          if (employeeId) {
            const existingEmployee = await this.prisma.employee.findUnique({
              where: { employeeId },
            })

            if (existingEmployee) {
              errors.push({
                row: record,
                error: `Employee already exists: ${employeeId}`,
              })
              continue
            }
          }

          // Check if CNIC already exists
          if (cnicNumber) {
            const existingCNIC = await this.prisma.employee.findUnique({
              where: { cnicNumber },
            })

            if (existingCNIC) {
              errors.push({
                row: record,
                error: `CNIC already exists: ${cnicNumber}`,
              })
              continue
            }
          }

          // Check if official email already exists
          if (officialEmail) {
            const existingEmail = await this.prisma.employee.findUnique({
              where: { officialEmail },
            })

            if (existingEmail) {
              errors.push({
                row: record,
                error: `Official email already exists: ${officialEmail}`,
              })
              continue
            }
          }

          // Parse selected equipments
          const selectedEquipments = record.SelectedEquipments || record.selectedEquipments || record['Selected Equipments'] || record['Selected-Equipments'] || ''
          const equipmentList = selectedEquipments.split(',').map((e: string) => e.trim().toLowerCase())

          // Validate required fields
          if (!employeeId) {
            errors.push({ row: record, error: 'Employee ID is required' })
            continue
          }
          if (!cnicNumber) {
            errors.push({ row: record, error: 'CNIC Number is required' })
            continue
          }
          if (!officialEmail) {
            errors.push({ row: record, error: 'Official Email is required' })
            continue
          }

          // Get reporting manager with fallback
          const reportingManager = record.ReportingManager || record.reportingManager || record['Reporting Manager'] || record['Reporting-Manager'] || 'N/A'
          
          // Get bank details with fallback
          const bankName = record.BankName || record.bankName || record['Bank Name'] || record['Bank-Name'] || 'N/A'
          const accountNumber = record.AccountNumber || record.accountNumber || record['Account Number'] || record['Account-Number'] || 'N/A'
          const accountTitle = record.AccountTitle || record.accountTitle || record['Account Title'] || record['Account-Title'] || record['Employee Name'] || record.EmployeeName || record.employeeName || 'N/A'

          // Parse dates
          const joiningDateStr = record['Joining-Date'] || record['Joining Date'] || record.JoiningDate || record.joiningDate
          const dateOfBirthStr = record['Date of Birth'] || record['Date Of Birth'] || record['Date-of-Birth'] || record.DateOfBirth || record.dateOfBirth
          const joiningDate = this.parseDate(joiningDateStr)
          const dateOfBirth = this.parseDate(dateOfBirthStr)

          // Validate required date fields
          if (!joiningDate) {
            errors.push({ row: record, error: `Invalid Joining Date format: ${joiningDateStr}` })
            continue
          }
          if (!dateOfBirth) {
            errors.push({ row: record, error: `Invalid Date of Birth format: ${dateOfBirthStr}` })
            continue
          }

          // Resolve entity names to IDs
          let departmentId: string
          let subDepartmentId: string | null = null
          let designationId: string
          let employeeGradeId: string
          let maritalStatusId: string
          let employmentStatusId: string
          let countryId: string | null = null
          let stateId: string | null = null
          let cityId: string | null = null
          let branchId: string
          let workingHoursPolicyId: string
          let leavesPolicyId: string

          try {
            // Resolve department
            const departmentName = record.Department || record.department
            if (!departmentName) {
              errors.push({ row: record, error: 'Department is required' })
              continue
            }
            departmentId = await this.findOrCreateDepartment(departmentName, ctx)

            // Resolve sub-department (optional)
            const subDepartmentName = record['Sub Department'] || record['Sub-Department'] || record.SubDepartment || record.subDepartment
            if (subDepartmentName) {
              subDepartmentId = await this.findOrCreateSubDepartment(subDepartmentName, departmentId, ctx)
            }

            // Resolve designation
            const designationName = record.Designation || record.designation
            if (!designationName) {
              errors.push({ row: record, error: 'Designation is required' })
              continue
            }
            designationId = await this.findOrCreateDesignation(designationName, ctx)

            // Resolve employee grade
            const employeeGradeName = record['Employee-Grade'] || record['Employee Grade'] || record.EmployeeGrade || record.employeeGrade
            if (!employeeGradeName) {
              errors.push({ row: record, error: 'Employee Grade is required' })
              continue
            }
            employeeGradeId = await this.findOrCreateEmployeeGrade(employeeGradeName, ctx)

            // Resolve marital status
            const maritalStatusName = record['Marital Status'] || record['Marital-Status'] || record.MaritalStatus || record.maritalStatus
            if (!maritalStatusName) {
              errors.push({ row: record, error: 'Marital Status is required' })
              continue
            }
            maritalStatusId = await this.findOrCreateMaritalStatus(maritalStatusName, ctx)

            // Resolve employment status
            const employmentStatusName = record['Employment Status'] || record['Employment-Status'] || record.EmploymentStatus || record.employmentStatus
            if (!employmentStatusName) {
              errors.push({ row: record, error: 'Employment Status is required' })
              continue
            }
            employmentStatusId = await this.findOrCreateEmploymentStatus(employmentStatusName, ctx)

            // Resolve country, state, city
            const countryName = record.Country || record.country
            if (!countryName || countryName.trim() === '') {
              errors.push({ row: record, error: 'Country is required' })
              continue
            }
            
            console.log(`🔍 Resolving country: "${countryName}" for employee: ${employeeId}`)
            countryId = await this.findCountryByName(countryName)
            console.log(`📍 Country resolution result: ${countryId ? countryId : 'NOT FOUND'}`)
            
            if (!countryId) {
              // Try to list some countries in the database for debugging
              const sampleCountries = await this.prisma.country.findMany({
                take: 5,
                select: { name: true, nicename: true },
              })
              console.log(`Available countries sample:`, sampleCountries)
              
              errors.push({ 
                row: record, 
                error: `Country not found: "${countryName}". Please ensure the country exists in the database. Sample countries: ${sampleCountries.map(c => c.nicename).join(', ')}` 
              })
              continue
            }

            const stateName = record.State || record.Province || record.province || record.state
            if (!stateName || stateName.trim() === '') {
              errors.push({ row: record, error: 'State/Province is required' })
              continue
            }
            
            console.log(`🔍 Resolving state: "${stateName}" in country: "${countryName}" for employee: ${employeeId}`)
            stateId = await this.findStateByName(stateName, countryId)
            console.log(`📍 State resolution result: ${stateId ? stateId : 'NOT FOUND'}`)
            
            if (!stateId) {
              const sampleStates = await this.prisma.state.findMany({
                where: { countryId },
                take: 5,
                select: { name: true },
              })
              errors.push({ 
                row: record, 
                error: `State/Province not found: "${stateName}" in country "${countryName}". Available states: ${sampleStates.map(s => s.name).join(', ') || 'None'}` 
              })
              continue
            }

            const cityName = record.City || record.city
            if (!cityName || cityName.trim() === '') {
              errors.push({ row: record, error: 'City is required' })
              continue
            }
            
            console.log(`🔍 Resolving city: "${cityName}" in state: "${stateName}" for employee: ${employeeId}`)
            cityId = await this.findCityByName(cityName, stateId)
            console.log(`📍 City resolution result: ${cityId ? cityId : 'NOT FOUND'}`)
            
            if (!cityId) {
              const sampleCities = await this.prisma.city.findMany({
                where: { stateId },
                take: 5,
                select: { name: true },
              })
              errors.push({ 
                row: record, 
                error: `City not found: "${cityName}" in state "${stateName}". Available cities: ${sampleCities.map(c => c.name).join(', ') || 'None'}` 
              })
              continue
            }

            // Final validation
            if (!countryId || !stateId || !cityId) {
              errors.push({ row: record, error: 'Country, State, and City are required and must be valid' })
              continue
            }

            // Resolve branch
            const branchName = record.Branch || record.branch
            if (!branchName) {
              errors.push({ row: record, error: 'Branch is required' })
              continue
            }
            branchId = await this.findOrCreateBranch(branchName, ctx)

            // Resolve working hours policy
            const workingHoursPolicyName = record['Working-Hours-Policy'] || record['Working Hours Policy'] || record.WorkingHoursPolicy || record.workingHoursPolicy
            if (!workingHoursPolicyName) {
              errors.push({ row: record, error: 'Working Hours Policy is required' })
              continue
            }
            workingHoursPolicyId = await this.findOrCreateWorkingHoursPolicy(workingHoursPolicyName, ctx)

            // Resolve leaves policy
            const leavesPolicyName = record['Leaves-Policy'] || record['Leaves Policy'] || record.LeavesPolicy || record.leavesPolicy
            if (!leavesPolicyName) {
              errors.push({ row: record, error: 'Leaves Policy is required' })
              continue
            }
            leavesPolicyId = await this.findOrCreateLeavesPolicy(leavesPolicyName, ctx)
          } catch (error: any) {
            errors.push({ row: record, error: error.message || 'Failed to resolve entity references' })
            continue
          }

          const result = await this.create(
            {
              employeeId: employeeId,
              employeeName: record['Employee Name'] || record['Employee-Name'] || record.EmployeeName || record.employeeName,
              fatherHusbandName: record['Father / Husband Name'] || record['Father/Husband Name'] || record['Father-Husband-Name'] || record.FatherHusbandName || record.fatherHusbandName,
              department: departmentId,
              subDepartment: subDepartmentId,
              employeeGrade: employeeGradeId,
              attendanceId: record['Attendance-ID'] || record['Attendance ID'] || record.AttendanceID || record.attendanceId,
              designation: designationId,
              maritalStatus: maritalStatusId,
              employmentStatus: employmentStatusId,
              probationExpiryDate: record['Probation Expiry Date'] || record['Probation-Expiry-Date'] || record.ProbationExpiryDate || record.probationExpiryDate || null,
              cnicNumber: cnicNumber,
              cnicExpiryDate: record['CNIC Expiry Date'] || record['CNIC-Expiry-Date'] || record.CNICExpiryDate || record.cnicExpiryDate || null,
              lifetimeCnic: record['Lifetime CNIC'] === 'true' || record['Lifetime-CNIC'] === 'true' || record.LifetimeCNIC === 'true' || record.lifetimeCnic === 'true' || false,
              joiningDate: joiningDate.toISOString(),
              dateOfBirth: dateOfBirth.toISOString(),
              nationality: record.Nationality || record.nationality,
              gender: record.Gender || record.gender,
              contactNumber: record['Contact-Number'] || record['Contact Number'] || record.ContactNumber || record.contactNumber,
              emergencyContactNumber: record.EmergencyContactNumber || record.emergencyContactNumber || record['Emergency Contact Number'] || record['Emergency-Contact-Number'] || null,
              emergencyContactPersonName: record.EmergencyContactPerson || record.emergencyContactPerson || record['Emergency Contact Person'] || record['Emergency-Contact-Person'] || null,
              personalEmail: record.PersonalEmail || record.personalEmail || record['Personal Email'] || record['Personal-Email'] || null,
              officialEmail: officialEmail,
              country: countryId,
              state: stateId,
              city: cityId,
              area: record.Area || record.area || null,
              employeeSalary: record['Employee-Salary(Compensation)'] || record['Employee-Salary'] || record['Employee Salary'] || record.EmployeeSalary || record.employeeSalary,
              eobi: record.EOBI === 'true' || record.eobi === 'true' || false,
              eobiNumber: record['EOBI Number'] || record['EOBI-Number'] || record.EOBINumber || record.eobiNumber || null,
              providentFund: record['Provident Fund'] === 'true' || record['Provident-Fund'] === 'true' || record.ProvidentFund === 'true' || record.providentFund === 'true' || false,
              overtimeApplicable: record['Overtime Applicable'] === 'true' || record['Overtime-Applicable'] === 'true' || record.OvertimeApplicable === 'true' || record.overtimeApplicable === 'true' || false,
              daysOff: record['Days Off'] || record['Days-Off'] || record.DaysOff || record.daysOff || null,
              reportingManager: reportingManager,
              workingHoursPolicy: workingHoursPolicyId,
              branch: branchId,
              leavesPolicy: leavesPolicyId,
              allowRemoteAttendance: record.AllowRemoteAttendance === 'true' || record.allowRemoteAttendance === 'true' || record['Allow Remote Attendance'] === 'true' || record['Allow-Remote-Attendance'] === 'true' || false,
              currentAddress: record.CurrentAddress || record.currentAddress || record['Current Address'] || record['Current-Address'] || null,
              permanentAddress: record.PermanentAddress || record.permanentAddress || record['Permanent Address'] || record['Permanent-Address'] || null,
              bankName: bankName,
              accountNumber: accountNumber,
              accountTitle: accountTitle,
              accountType: record.AccountType || record.accountType || record['Account Type'] || record['Account-Type'] || null,
              password: record.Password || record.password || null,
              roles: record.Roles || record.roles || null,
              selectedEquipments: equipmentList,
              status: record.Status || record.status || 'active',
            },
            ctx,
          )

          if (result.status) {
            results.push(result.data)
          } else {
            console.error('Create employee failed:', result.message)
            errors.push({ row: record, error: result.message || 'Failed to create employee' })
          }
        } catch (error: any) {
          console.error('Exception while creating employee:', error)
          errors.push({ row: record, error: error.message || 'Unknown error occurred' })
        }
      }

      // Log errors for debugging
      if (errors.length > 0) {
        console.log('Import errors:', JSON.stringify(errors, null, 2))
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
      })

      return {
        status: errors.length === 0,
        data: results,
        errors: errors.length > 0 ? errors : undefined,
        message: errors.length > 0
          ? `${results.length} records imported, ${errors.length} failed`
          : `${results.length} records imported successfully`,
      }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'bulk_upload',
        module: 'employees',
        entity: 'Employee',
        description: 'Failed to bulk upload employees',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: error?.message || 'Failed to process file' }
    }
  }
}
