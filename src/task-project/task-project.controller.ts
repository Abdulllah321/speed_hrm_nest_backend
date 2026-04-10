import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { TaskProjectService } from './task-project.service';
import {
  CreateTaskProjectDto,
  UpdateTaskProjectDto,
  AddProjectMemberDto,
} from './dto/task-project.dto';

@ApiTags('Task Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/task-projects')
export class TaskProjectController {
  constructor(private service: TaskProjectService) {}

  @Get()
  @Permissions('task.project.read')
  @ApiOperation({ summary: 'List all task projects' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'ownerId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  list(
    @Query('status') status?: string,
    @Query('ownerId') ownerId?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.service.list({ status, ownerId, departmentId });
  }

  @Post()
  @Permissions('task.project.create')
  @ApiOperation({ summary: 'Create a task project' })
  create(@Body() body: CreateTaskProjectDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get(':id')
  @Permissions('task.project.read')
  @ApiOperation({ summary: 'Get task project by id' })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Put(':id')
  @Permissions('task.project.update')
  @ApiOperation({ summary: 'Update task project' })
  update(@Param('id') id: string, @Body() body: UpdateTaskProjectDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Permissions('task.project.delete')
  @ApiOperation({ summary: 'Delete task project' })
  remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  @Get(':id/members')
  @Permissions('task.project.read')
  @ApiOperation({ summary: 'List project members' })
  listMembers(@Param('id') id: string) {
    return this.service.listMembers(id);
  }

  @Post(':id/members')
  @Permissions('task.project.manage-members')
  @ApiOperation({ summary: 'Add member to project' })
  addMember(@Param('id') id: string, @Body() body: AddProjectMemberDto, @Req() req) {
    return this.service.addMember(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id/members/:employeeId')
  @Permissions('task.project.manage-members')
  @ApiOperation({ summary: 'Remove member from project' })
  removeMember(@Param('id') id: string, @Param('employeeId') employeeId: string, @Req() req) {
    return this.service.removeMember(id, employeeId, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
