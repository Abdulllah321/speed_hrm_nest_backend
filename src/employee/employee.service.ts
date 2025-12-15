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
      },
    })
    return { status: true, data: employees }
  }

  async get(id: string) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { id },
      include: {
        qualifications: true,
      },
    })
    if (!employee) return { status: false, message: 'Employee not found' }
    return { status: true, data: employee }
  }

  async create(body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.employee.create({
        data: {
          employeeId: body.employeeId,
          employeeName: body.employeeName,
          fatherHusbandName: body.fatherHusbandName,
          department: body.department,
          subDepartment: body.subDepartment ?? null,
          employeeGrade: body.employeeGrade,
          attendanceId: body.attendanceId,
          designation: body.designation,
          maritalStatus: body.maritalStatus,
          employmentStatus: body.employmentStatus,
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
          country: body.country,
          province: body.state,
          city: body.city,
          area: body.area ?? null,
          employeeSalary: body.employeeSalary as any,
          eobi: !!body.eobi,
          eobiNumber: body.eobiNumber ?? null,
          providentFund: !!body.providentFund,
          overtimeApplicable: !!body.overtimeApplicable,
          daysOff: body.daysOff ?? null,
          reportingManager: body.reportingManager,
          workingHoursPolicy: body.workingHoursPolicy,
          branch: body.branch,
          leavesPolicy: body.leavesPolicy,
          allowRemoteAttendance: !!body.allowRemoteAttendance,
          currentAddress: body.currentAddress ?? null,
          permanentAddress: body.permanentAddress ?? null,
          bankName: body.bankName,
          accountNumber: body.accountNumber,
          accountTitle: body.accountTitle,
          accountType: body.accountType ?? null,
          password: body.password ?? null,
          roles: body.roles ?? null,
          laptop: !!body.selectedEquipments?.includes('laptop'),
          card: !!body.selectedEquipments?.includes('card'),
          mobileSim: !!body.selectedEquipments?.includes('mobileSim'),
          key: !!body.selectedEquipments?.includes('key'),
          tools: !!body.selectedEquipments?.includes('tools'),
          status: 'active',
          qualifications: body.qualifications && Array.isArray(body.qualifications) && body.qualifications.length > 0
            ? {
                create: body.qualifications.map((q: any) => ({
                  qualification: q.qualification || '',
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

      const updated = await this.prisma.employee.update({
        where: { id },
        data: {
          employeeName: body.employeeName ?? existing?.employeeName,
          fatherHusbandName: body.fatherHusbandName ?? existing?.fatherHusbandName,
          department: body.department ?? existing?.department,
          subDepartment: body.subDepartment ?? existing?.subDepartment,
          employeeGrade: body.employeeGrade ?? existing?.employeeGrade,
          attendanceId: body.attendanceId ?? existing?.attendanceId,
          designation: body.designation ?? existing?.designation,
          maritalStatus: body.maritalStatus ?? existing?.maritalStatus,
          employmentStatus: body.employmentStatus ?? existing?.employmentStatus,
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
          country: body.country ?? existing?.country,
          province: body.state ?? existing?.province,
          city: body.city ?? existing?.city,
          area: body.area ?? existing?.area,
          employeeSalary: body.employeeSalary !== undefined ? (body.employeeSalary as any) : existing?.employeeSalary,
          eobi: body.eobi ?? existing?.eobi,
          eobiNumber: body.eobiNumber ?? existing?.eobiNumber,
          providentFund: body.providentFund ?? existing?.providentFund,
          overtimeApplicable: body.overtimeApplicable ?? existing?.overtimeApplicable,
          daysOff: body.daysOff ?? existing?.daysOff,
          reportingManager: body.reportingManager ?? existing?.reportingManager,
          workingHoursPolicy: body.workingHoursPolicy ?? existing?.workingHoursPolicy,
          branch: body.branch ?? existing?.branch,
          leavesPolicy: body.leavesPolicy ?? existing?.leavesPolicy,
          allowRemoteAttendance: body.allowRemoteAttendance ?? existing?.allowRemoteAttendance,
          currentAddress: body.currentAddress ?? existing?.currentAddress,
          permanentAddress: body.permanentAddress ?? existing?.permanentAddress,
          bankName: body.bankName ?? existing?.bankName,
          accountNumber: body.accountNumber ?? existing?.accountNumber,
          accountTitle: body.accountTitle ?? existing?.accountTitle,
          accountType: body.accountType ?? existing?.accountType,
          password: body.password ?? existing?.password,
          roles: body.roles ?? existing?.roles,
          laptop: body.selectedEquipments ? !!body.selectedEquipments?.includes('laptop') : existing?.laptop,
          card: body.selectedEquipments ? !!body.selectedEquipments?.includes('card') : existing?.card,
          mobileSim: body.selectedEquipments ? !!body.selectedEquipments?.includes('mobileSim') : existing?.mobileSim,
          key: body.selectedEquipments ? !!body.selectedEquipments?.includes('key') : existing?.key,
          tools: body.selectedEquipments ? !!body.selectedEquipments?.includes('tools') : existing?.tools,
          status: body.status ?? existing?.status,
          qualifications: body.qualifications !== undefined && Array.isArray(body.qualifications) && body.qualifications.length > 0
            ? {
                create: body.qualifications.map((q: any) => ({
                  qualification: q.qualification || '',
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
      return { status: true, data: updated }
    } catch (error: any) {
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
      return { status: false, message: 'Failed to update employee' }
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

          const result = await this.create(
            {
              employeeId: employeeId,
              employeeName: record['Employee Name'] || record['Employee-Name'] || record.EmployeeName || record.employeeName,
              fatherHusbandName: record['Father / Husband Name'] || record['Father/Husband Name'] || record['Father-Husband-Name'] || record.FatherHusbandName || record.fatherHusbandName,
              department: record.Department || record.department,
              subDepartment: record['Sub Department'] || record['Sub-Department'] || record.SubDepartment || record.subDepartment || null,
              employeeGrade: record['Employee-Grade'] || record['Employee Grade'] || record.EmployeeGrade || record.employeeGrade,
              attendanceId: record['Attendance-ID'] || record['Attendance ID'] || record.AttendanceID || record.attendanceId,
              designation: record.Designation || record.designation,
              maritalStatus: record['Marital Status'] || record['Marital-Status'] || record.MaritalStatus || record.maritalStatus,
              employmentStatus: record['Employment Status'] || record['Employment-Status'] || record.EmploymentStatus || record.employmentStatus,
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
              country: record.Country || record.country,
              state: record.State || record.Province || record.province || record.state,
              city: record.City || record.city,
              area: record.Area || record.area || null,
              employeeSalary: record['Employee-Salary(Compensation)'] || record['Employee-Salary'] || record['Employee Salary'] || record.EmployeeSalary || record.employeeSalary,
              eobi: record.EOBI === 'true' || record.eobi === 'true' || false,
              eobiNumber: record['EOBI Number'] || record['EOBI-Number'] || record.EOBINumber || record.eobiNumber || null,
              providentFund: record['Provident Fund'] === 'true' || record['Provident-Fund'] === 'true' || record.ProvidentFund === 'true' || record.providentFund === 'true' || false,
              overtimeApplicable: record['Overtime Applicable'] === 'true' || record['Overtime-Applicable'] === 'true' || record.OvertimeApplicable === 'true' || record.overtimeApplicable === 'true' || false,
              daysOff: record['Days Off'] || record['Days-Off'] || record.DaysOff || record.daysOff || null,
              reportingManager: reportingManager,
              workingHoursPolicy: record['Working-Hours-Policy'] || record['Working Hours Policy'] || record.WorkingHoursPolicy || record.workingHoursPolicy,
              branch: record.Branch || record.branch,
              leavesPolicy: record['Leaves-Policy'] || record['Leaves Policy'] || record.LeavesPolicy || record.leavesPolicy,
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
