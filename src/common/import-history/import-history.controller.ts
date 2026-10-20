import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ImportHistoryService } from './import-history.service';
import { ListImportsQueryDto } from './dto/import-history.dto';

@ApiTags('Import History')
@Controller('api/import-history')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ImportHistoryController {
  constructor(private readonly service: ImportHistoryService) {}

  @Get('modules')
  @ApiOperation({ summary: 'List all available import module names' })
  getModules() {
    return { status: true, data: this.service.getAvailableModules() };
  }

  @Get()
  @ApiOperation({ summary: 'List import history (filterable by module, status, search)' })
  async listImports(@Req() req: any, @Query() query: ListImportsQueryDto) {
    const userId = req.user?.userId ?? req.user?.id;
    const result = await this.service.listImports(userId, query);
    return { status: true, data: result.data, meta: result.meta };
  }

  @Get(':uploadId')
  @ApiOperation({ summary: 'Get a single import history record with full details' })
  async getImportDetail(@Req() req: any, @Param('uploadId') uploadId: string) {
    const userId = req.user?.userId ?? req.user?.id;
    const result = await this.service.getImportDetail(userId, uploadId);
    return { status: true, data: result };
  }

  @Get(':uploadId/error-report')
  @ApiOperation({ summary: 'Download the error report CSV for an import' })
  async downloadErrorReport(
    @Req() req: any,
    @Param('uploadId') uploadId: string,
    @Res() res: any,
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    try {
      await this.service.streamErrorReport(userId, uploadId, res);
    } catch (err: any) {
      const statusCode = err?.status ?? 404;
      res.status(statusCode).send({
        status: false,
        message: err?.message ?? 'Error report not found',
      });
    }
  }

  @Get(':uploadId/download')
  @ApiOperation({ summary: 'Download the original uploaded file for an import' })
  async downloadUploadedFile(
    @Req() req: any,
    @Param('uploadId') uploadId: string,
    @Res() res: any,
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    try {
      await this.service.streamUploadedFile(userId, uploadId, res);
    } catch (err: any) {
      const statusCode = err?.status ?? 404;
      res.status(statusCode).send({
        status: false,
        message: err?.message ?? 'File not found',
      });
    }
  }

  @Get(':uploadId/success-report')
  @ApiOperation({ summary: 'Download the success report for an import' })
  async downloadSuccessReport(
    @Req() req: any,
    @Param('uploadId') uploadId: string,
    @Res() res: any,
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    try {
      await this.service.streamSuccessReport(userId, uploadId, res);
    } catch (err: any) {
      const statusCode = err?.status ?? 404;
      res.status(statusCode).send({
        status: false,
        message: err?.message ?? 'Success report not found',
      });
    }
  }
}
