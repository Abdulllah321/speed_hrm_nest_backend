import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards, Req } from '@nestjs/common'
import { DepartmentService } from './department.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import {  UpdateDepartmentDto, UpdateSubDepartmentDto } from './dto/department-dto'

@Controller('api')
export class DepartmentController {
  constructor(private service: DepartmentService) {}

  @Get('departments')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.getAllDepartments()
  }

  @Get('departments/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.getDepartmentById(id)
  }

  @Post('departments')
  @UseGuards(JwtAuthGuard)
  async createBulk(@Body() body: { names: string[] }, @Req() req) {
    return this.service.createDepartments(body.names, req.user.userId)
  }

  @Put('departments/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() updateDepartmentDto: UpdateDepartmentDto, @Req() req) {
    return this.service.updateDepartment(id, updateDepartmentDto, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('departments/bulk')
  @UseGuards(JwtAuthGuard)
  async updateBulk(@Body() body: { items: UpdateDepartmentDto[] }, @Req() req) {
    return this.service.updateDepartments(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('departments/:id')
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') id: string, @Req() req) {
    return this.service.deleteDepartment(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('departments/bulk')
  @UseGuards(JwtAuthGuard)
  async deleteBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.deleteDepartments(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

 

  @Get('sub-departments')
  @UseGuards(JwtAuthGuard)
  async subDepartments() {
    return this.service.getAllSubDepartments()
  }

  @Get('sub-departments/department/:departmentId')
  @UseGuards(JwtAuthGuard)
  async subDepartmentsByDept(@Param('departmentId') departmentId: string) {
    return this.service.getSubDepartmentsByDepartment(departmentId)
  }

  @Post('sub-departments')
  @UseGuards(JwtAuthGuard)
  async createSub(@Body() body: { name: string; departmentId: string; headId?: string }, @Req() req) {
    const item = { name: body.name, departmentId: body.departmentId, createdById: req.user.userId, headId: body.headId } as any
    return this.service.createSubDepartments([item], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('sub-departments/bulk')
  @UseGuards(JwtAuthGuard)
  async createSubBulk(@Body() body: { items: { name: string; departmentId: string; headId?: string }[] }, @Req() req) {
    const subDepartmentsToCreate = (body.items || []).map(dto => ({
      name: dto.name,
      departmentId: dto.departmentId,
      createdById: req.user.userId,
      headId: dto.headId,
    })) as any[]
    return this.service.createSubDepartments(subDepartmentsToCreate, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('sub-departments/:id')
  @UseGuards(JwtAuthGuard)
  async updateSub(@Param('id') id: string, @Body() updateSubDepartmentDto: UpdateSubDepartmentDto, @Req() req) {
    return this.service.updateSubDepartment(id, updateSubDepartmentDto, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('sub-departments/bulk')
  @UseGuards(JwtAuthGuard)
  async updateSubBulk(@Body() updateSubDepartmentDto: UpdateSubDepartmentDto[], @Req() req) {
    return this.service.updateSubDepartments(updateSubDepartmentDto, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
  
  @Delete('sub-departments/bulk')
  @UseGuards(JwtAuthGuard)
  async deleteSubBulk(@Body() subDepartmentIds: string[], @Req() req) {
    return this.service.deleteSubDepartments(subDepartmentIds, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('sub-departments/:id')
  @UseGuards(JwtAuthGuard)
  async deleteSub(@Param('id') id: string, @Req() req) {
    return this.service.deleteSubDepartment(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
