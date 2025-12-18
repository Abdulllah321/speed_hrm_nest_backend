import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { EmployeeService } from './employee.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import type { FastifyRequest } from 'fastify'
import * as fs from 'fs'
import * as path from 'path'

@Controller('api')
export class EmployeeController {
  constructor(private service: EmployeeService) {}

  @Get('employees')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('employees/for-attendance')
  @UseGuards(JwtAuthGuard)
  async listForAttendance(@Query('departmentId') departmentId?: string, @Query('subDepartmentId') subDepartmentId?: string) {
    return this.service.listForAttendance({ departmentId, subDepartmentId })
  }

  @Get('employees/dropdown')
  @UseGuards(JwtAuthGuard)
  async listForDropdown() {
    return this.service.listForDropdown()
  }

  @Get('employees/rejoin/search')
  @UseGuards(JwtAuthGuard)
  async searchForRejoin(@Query('cnic') cnic: string) {
    if (!cnic) {
      return { status: false, message: 'CNIC is required' }
    }
    return this.service.findByCnicForRejoin(cnic)
  }

  @Post('employees/rejoin')
  @UseGuards(JwtAuthGuard)
  async rejoinEmployee(@Body() body: any, @Req() req) {
    if (!body.cnic) {
      return { status: false, message: 'CNIC is required' }
    }
    return this.service.rejoinEmployee(body.cnic, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Get('employees/:id/rejoining-history')
  @UseGuards(JwtAuthGuard)
  async getRejoiningHistory(@Param('id') id: string) {
    return this.service.getRejoiningHistory(id)
  }

  @Get('employees/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('employees')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: any, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('employees/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('employees/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('employees/import-csv')
  @UseGuards(JwtAuthGuard)
  async importCsv(@Req() request: FastifyRequest) {
    const data = await request.file()
    if (!data) {
      return { status: false, message: 'No file provided' }
    }

    // Validate file extension
    const fileExtension = path.extname(data.filename).toLowerCase()
    if (fileExtension !== '.csv' && fileExtension !== '.xlsx') {
      return { status: false, message: 'Invalid file format. Please upload a CSV (.csv) or Excel (.xlsx) file' }
    }

    // Save file temporarily
    const uploadRoot = path.join(process.cwd(), 'public', 'csv')
    if (!fs.existsSync(uploadRoot)) {
      fs.mkdirSync(uploadRoot, { recursive: true })
    }

    const ts = Date.now()
    const safeFilename = data.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')
    const filename = `${ts}_${safeFilename}`
    const fullPath = path.join(uploadRoot, filename)

    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(fullPath)
      data.file.pipe(writeStream)
      writeStream.on('finish', () => resolve())
      writeStream.on('error', reject)
    })

    try {
      const result = await this.service.bulkUploadFromCSV(fullPath, {
        userId: request.user?.userId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      })

      // Clean up file after processing
      try {
        fs.unlinkSync(fullPath)
      } catch (e) {
        // Failed to delete temp file
      }

      return result
    } catch (error: any) {
      // Clean up file on error
      try {
        fs.unlinkSync(fullPath)
      } catch (e) {
        // Failed to delete temp file
      }
      return { status: false, message: error?.message || 'Failed to process file' }
    }
  }
}
