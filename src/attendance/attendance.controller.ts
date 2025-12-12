import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { AttendanceService } from './attendance.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import type { FastifyRequest } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import * as fs from 'fs'
import * as path from 'path'

@Controller('api')
export class AttendanceController {
  constructor(private service: AttendanceService) {}

  @Get('attendances')
  @UseGuards(JwtAuthGuard)
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list({
      employeeId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      status,
    })
  }

  @Get('attendances/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('attendances')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: any, @Req() req: any) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('attendances/date-range')
  @UseGuards(JwtAuthGuard)
  async createForDateRange(@Body() body: any, @Req() req: any) {
    return this.service.createForDateRange(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('attendances/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('attendances/:id')
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.service.delete(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('attendances/bulk-upload')
  @UseGuards(JwtAuthGuard)
  async bulkUpload(@Req() request: FastifyRequest) {
    const data = await request.file()
    if (!data) {
      return { status: false, message: 'No file provided' }
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
        console.warn('Failed to delete temp file:', e)
      }

      return result
    } catch (error: any) {
      // Clean up file on error
      try {
        fs.unlinkSync(fullPath)
      } catch (e) {
        console.warn('Failed to delete temp file:', e)
      }
      return { status: false, message: error?.message || 'Failed to process file' }
    }
  }
}

