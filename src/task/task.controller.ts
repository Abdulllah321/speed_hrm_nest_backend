import {
  Body, Controller, Delete, Get, Param, Post, Put,
  Query, Req, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { TaskService } from './task.service';
import { UploadService } from '../upload/upload.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  ChangeTaskStatusDto,
  UpdateAssigneesDto,
  ReorderTasksDto,
  BulkTaskActionDto,
  CreateCommentDto,
  UpdateCommentDto,
} from './dto/task.dto';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/tasks')
export class TaskController {
  constructor(
    private service: TaskService,
    private uploadService: UploadService,
  ) {}

  private ctx(req: any) {
    return { userId: req.user?.userId, employeeId: req.user?.employeeId, ipAddress: req.ip, userAgent: req.headers['user-agent'] };
  }

  // ─── Core CRUD ────────────────────────────────────────────────────────────────

  @Get()
  @Permissions('task.read')
  @ApiOperation({ summary: 'List tasks with filters' })
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'listId', required: false })
  @ApiQuery({ name: 'assigneeId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'dueBefore', required: false })
  @ApiQuery({ name: 'parentTaskId', required: false })
  list(
    @Query('projectId') projectId?: string,
    @Query('listId') listId?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('dueBefore') dueBefore?: string,
    @Query('parentTaskId') parentTaskId?: string,
  ) {
    return this.service.list({ projectId, listId, assigneeId, status, priority, dueBefore, parentTaskId });
  }

  @Post()
  @Permissions('task.create')
  @ApiOperation({ summary: 'Create a task' })
  create(@Body() body: CreateTaskDto, @Req() req) {
    return this.service.create(body, this.ctx(req));
  }

  @Get('my-tasks')
  @Permissions('task.read')
  @ApiOperation({ summary: 'Get tasks assigned to current user' })
  myTasks(@Req() req) {
    const employeeId = req.user?.employeeId;
    if (!employeeId) return { status: false, message: 'Employee ID not found in token' };
    return this.service.myTasks(employeeId);
  }

  @Get('overdue')
  @Permissions('task.manage-all')
  @ApiOperation({ summary: 'Get all overdue tasks' })
  overdue() {
    return this.service.overdueTasks();
  }

  @Put('reorder')
  @Permissions('task.update')
  @ApiOperation({ summary: 'Reorder tasks (drag-and-drop)' })
  reorder(@Body() body: ReorderTasksDto) {
    return this.service.reorder(body);
  }

  @Post('bulk')
  @Permissions('task.update')
  @ApiOperation({ summary: 'Bulk action: change_status | change_priority | reassign | delete' })
  bulkAction(@Body() body: BulkTaskActionDto, @Req() req) {
    return this.service.bulkAction(body, this.ctx(req));
  }

  @Get(':id')
  @Permissions('task.read')
  @ApiOperation({ summary: 'Get task detail with subtasks, assignees, attachments' })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Put(':id')
  @Permissions('task.update')
  @ApiOperation({ summary: 'Update task' })
  update(@Param('id') id: string, @Body() body: UpdateTaskDto, @Req() req) {
    return this.service.update(id, body, this.ctx(req));
  }

  @Delete(':id')
  @Permissions('task.delete')
  @ApiOperation({ summary: 'Delete task' })
  remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, this.ctx(req));
  }

  // ─── Status ───────────────────────────────────────────────────────────────────

  @Put(':id/status')
  @Permissions('task.update')
  @ApiOperation({ summary: 'Change task status (triggers notifications + KPI hook)' })
  changeStatus(@Param('id') id: string, @Body() body: ChangeTaskStatusDto, @Req() req) {
    return this.service.changeStatus(id, body, this.ctx(req));
  }

  // ─── Assignees ────────────────────────────────────────────────────────────────

  @Put(':id/assignees')
  @Permissions('task.assign')
  @ApiOperation({ summary: 'Update task assignees' })
  updateAssignees(@Param('id') id: string, @Body() body: UpdateAssigneesDto, @Req() req) {
    return this.service.updateAssignees(id, body, this.ctx(req));
  }

  // ─── Attachments ──────────────────────────────────────────────────────────────

  @Post(':id/attachments')
  @Permissions('task.update')
  @ApiOperation({ summary: 'Upload attachment to task' })
  @ApiConsumes('multipart/form-data')
  async addAttachment(@Param('id') taskId: string, @Req() req) {
    try {
      const file = await req.file();
      if (!file) return { status: false, message: 'No file provided' };

      const uploaded = await this.uploadService.uploadFile(file, req.user?.userId);
      if (!uploaded.status) return uploaded;

      return this.service.addAttachment(taskId, {
        fileName: uploaded.data.filename,
        fileUrl: uploaded.data.url,
        fileSize: uploaded.data.size,
        mimeType: uploaded.data.mimetype,
      }, this.ctx(req));
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Upload failed' };
    }
  }

  @Delete(':id/attachments/:attachId')
  @Permissions('task.update')
  @ApiOperation({ summary: 'Remove attachment from task' })
  removeAttachment(@Param('id') taskId: string, @Param('attachId') attachId: string) {
    return this.service.removeAttachment(taskId, attachId);
  }

  // ─── Comments ─────────────────────────────────────────────────────────────────

  @Get(':id/comments')
  @Permissions('task.read')
  @ApiOperation({ summary: 'List task comments (threaded)' })
  listComments(@Param('id') id: string) {
    return this.service.listComments(id);
  }

  @Post(':id/comments')
  @Permissions('task.read')
  @ApiOperation({ summary: 'Add comment to task' })
  createComment(@Param('id') id: string, @Body() body: CreateCommentDto, @Req() req) {
    return this.service.createComment(id, body, this.ctx(req));
  }

  @Put('comments/:commentId')
  @Permissions('task.read')
  @ApiOperation({ summary: 'Edit a comment' })
  updateComment(@Param('commentId') commentId: string, @Body() body: UpdateCommentDto, @Req() req) {
    return this.service.updateComment(commentId, body, this.ctx(req));
  }

  @Delete('comments/:commentId')
  @Permissions('task.read')
  @ApiOperation({ summary: 'Delete a comment' })
  deleteComment(@Param('commentId') commentId: string, @Req() req) {
    return this.service.deleteComment(commentId, this.ctx(req));
  }

  // ─── Activity ─────────────────────────────────────────────────────────────────

  @Get(':id/activity')
  @Permissions('task.read')
  @ApiOperation({ summary: 'Get task activity feed' })
  listActivity(@Param('id') id: string) {
    return this.service.listActivity(id);
  }

  // ─── Reviews ─────────────────────────────────────────────────────────────────

  @Post(':id/review')
  @Permissions('task.review')
  @ApiOperation({ summary: 'Submit quality review for a completed task' })
  createReview(@Param('id') id: string, @Body() body: { rating: number; feedback?: string }, @Req() req) {
    return this.service.createReview(id, body, this.ctx(req));
  }

  @Get(':id/review')
  @Permissions('task.read')
  @ApiOperation({ summary: 'Get review for a task' })
  getReview(@Param('id') id: string) {
    return this.service.getReview(id);
  }
}
