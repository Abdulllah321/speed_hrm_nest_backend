import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { TaskListService } from './task-list.service';
import { CreateTaskListDto, UpdateTaskListDto, ReorderTaskListDto } from './dto/task-list.dto';

@ApiTags('Task Lists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api')
export class TaskListController {
  constructor(private service: TaskListService) {}

  @Get('task-projects/:projectId/lists')
  @Permissions('task.read')
  @ApiOperation({ summary: 'List task lists for a project' })
  listByProject(@Param('projectId') projectId: string) {
    return this.service.listByProject(projectId);
  }

  @Post('task-projects/:projectId/lists')
  @Permissions('task.create')
  @ApiOperation({ summary: 'Create a task list in a project' })
  create(@Param('projectId') projectId: string, @Body() body: CreateTaskListDto, @Req() req) {
    return this.service.create(projectId, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('task-lists/reorder')
  @Permissions('task.update')
  @ApiOperation({ summary: 'Reorder task lists (bulk position update)' })
  reorder(@Body() body: ReorderTaskListDto) {
    return this.service.reorder(body);
  }

  @Put('task-lists/:id')
  @Permissions('task.update')
  @ApiOperation({ summary: 'Update a task list' })
  update(@Param('id') id: string, @Body() body: UpdateTaskListDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('task-lists/:id')
  @Permissions('task.delete')
  @ApiOperation({ summary: 'Delete a task list' })
  remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
