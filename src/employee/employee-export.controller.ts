import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { EmployeeExportService } from './employee-export.service';

@ApiTags('Employee Export')
@Controller('api/employees/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class EmployeeExportController {
  constructor(private readonly exportService: EmployeeExportService) {}

  /**
   * POST /api/employees/export
   * Queues a background export job. Returns immediately with a jobId.
   * User receives an in-app notification when the file is ready.
   */
  @Post()
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Queue an employee export job (returns immediately, notifies when done)' })
  async queueExport(
    @Req() req: any,
    @Query('search')       search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('designationId')designationId?: string,
    @Query('status')       status?: string,
  ) {
    const result = await this.exportService.queueExport({
      userId: req.user?.userId,
      search,
      departmentId,
      designationId,
      status,
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * GET /api/employees/export/:jobId/status
   */
  @Get(':jobId/status')
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Check employee export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/employees/export/:jobId/download
   * Streams the completed Excel file. Auto-deletes after download.
   */
  @Get(':jobId/download')
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Download a completed employee export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
