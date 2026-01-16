import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';
import { DepartmentService } from './department.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  UpdateDepartmentDto,
  UpdateSubDepartmentDto,
  BulkUpdateDepartmentDto,
  BulkUpdateDepartmentItemDto,
} from './dto/department-dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Department')
@Controller('api')
export class DepartmentController {
  constructor(private service: DepartmentService) {}

  @Get('departments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all departments' })
  async list() {
    return this.service.getAllDepartments();
  }

  @Get('departments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get department by id' })
  async get(@Param('id') id: string) {
    return this.service.getDepartmentById(id);
  }

  @Post('departments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create departments in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              allocationId: { type: 'string' },
              headId: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async createBulk(
    @Body()
    body: { items: { name: string; allocationId?: string; headId?: string }[] },
    @Req() req,
  ) {
    return this.service.createDepartments(body.items || [], req.user.userId);
  }

  @Put('departments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update department' })
  async update(
    @Param('id') id: string,
    @Body() updateDepartmentDto: UpdateDepartmentDto,
    @Req() req,
  ) {
    return this.service.updateDepartment(id, updateDepartmentDto, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('departments/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update departments in bulk' })
  @ApiBody({ type: BulkUpdateDepartmentDto })
  async updateBulk(@Body() body: BulkUpdateDepartmentDto, @Req() req) {
    return this.service.updateDepartments(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('departments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete department' })
  async delete(@Param('id') id: string, @Req() req) {
    return this.service.deleteDepartment(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('departments/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete departments in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          example: ['uuid1', 'uuid2'],
        },
      },
    },
  })
  async deleteBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.deleteDepartments(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('sub-departments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all sub-departments' })
  async subDepartments() {
    return this.service.getAllSubDepartments();
  }

  @Get('sub-departments/department/:departmentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List sub-departments by department' })
  async subDepartmentsByDept(@Param('departmentId') departmentId: string) {
    return this.service.getSubDepartmentsByDepartment(departmentId);
  }

  @Post('sub-departments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create sub-department' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'QA' },
        departmentId: { type: 'string', example: 'dept-uuid' },
        headId: { type: 'string', example: 'user-uuid' },
      },
    },
  })
  async createSub(
    @Body() body: { name: string; departmentId: string; headId?: string },
    @Req() req,
  ) {
    const item = {
      name: body.name,
      departmentId: body.departmentId,
      createdById: req.user.userId,
      headId: body.headId,
    } as any;
    return this.service.createSubDepartments([item], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('sub-departments/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create sub-departments in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              departmentId: { type: 'string' },
              headId: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async createSubBulk(
    @Body()
    body: { items: { name: string; departmentId: string; headId?: string }[] },
    @Req() req,
  ) {
    const subDepartmentsToCreate = (body.items || []).map((dto) => ({
      name: dto.name,
      departmentId: dto.departmentId,
      createdById: req.user.userId,
      headId: dto.headId,
    })) as any[];
    return this.service.createSubDepartments(subDepartmentsToCreate, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('sub-departments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update sub-department' })
  async updateSub(
    @Param('id') id: string,
    @Body() updateSubDepartmentDto: UpdateSubDepartmentDto,
    @Req() req,
  ) {
    return this.service.updateSubDepartment(id, updateSubDepartmentDto, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('sub-departments/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update sub-departments in bulk' })
  @ApiBody({ type: UpdateSubDepartmentDto, isArray: true })
  async updateSubBulk(
    @Body() updateSubDepartmentDto: UpdateSubDepartmentDto[],
    @Req() req,
  ) {
    return this.service.updateSubDepartments(updateSubDepartmentDto || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('sub-departments/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete sub-departments in bulk' })
  @ApiBody({
    schema: { type: 'array', items: { type: 'string', example: 'uuid' } },
  })
  async deleteSubBulk(@Body() subDepartmentIds: string[], @Req() req) {
    return this.service.deleteSubDepartments(subDepartmentIds, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('sub-departments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete sub-department' })
  async deleteSub(@Param('id') id: string, @Req() req) {
    return this.service.deleteSubDepartment(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
