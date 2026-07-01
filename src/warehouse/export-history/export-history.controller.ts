import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ExportHistoryService } from './export-history.service';
import { CreateFolderDto, RenameFolderDto, UpdateExportDto, BulkDeleteDto, BulkMoveDto, BulkRenameDto } from './dto/export-history.dto';

@ApiTags('Export History')
@Controller('api/export-history')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ExportHistoryController {
  constructor(private readonly service: ExportHistoryService) {}

  @Post('folders')
  @ApiOperation({ summary: 'Create a new export folder' })
  async createFolder(@Req() req: any, @Body() dto: CreateFolderDto) {
    const userId = req.user?.userId || req.user?.id;
    const result = await this.service.createFolder(userId, dto.name);
    return { status: true, data: result };
  }

  @Get('folders')
  @ApiOperation({ summary: 'List all export folders' })
  async listFolders(@Req() req: any) {
    const userId = req.user?.userId || req.user?.id;
    const result = await this.service.listFolders(userId);
    return { status: true, data: result };
  }

  @Patch('folders/:id')
  @ApiOperation({ summary: 'Rename an export folder' })
  async renameFolder(
    @Req() req: any,
    @Param('id') folderId: string,
    @Body() dto: RenameFolderDto,
  ) {
    const userId = req.user?.userId || req.user?.id;
    const result = await this.service.renameFolder(userId, folderId, dto.name);
    return { status: true, data: result };
  }

  @Delete('folders/:id')
  @ApiOperation({ summary: 'Delete an export folder' })
  async deleteFolder(@Req() req: any, @Param('id') folderId: string) {
    const userId = req.user?.userId || req.user?.id;
    await this.service.deleteFolder(userId, folderId);
    return { status: true, message: 'Folder deleted successfully' };
  }

  @Get()
  @ApiOperation({ summary: 'List all export history items' })
  async listExports(
    @Req() req: any,
    @Query('folderId') folderId?: string,
    @Query('isFavorite') isFavorite?: string,
    @Query('search') search?: string,
    @Query('moduleName') moduleName?: string,
  ) {
    const userId = req.user?.userId || req.user?.id;
    
    const favoriteBool = isFavorite === 'true' ? true : isFavorite === 'false' ? false : undefined;

    const result = await this.service.listExports(userId, {
      folderId,
      isFavorite: favoriteBool,
      search,
      moduleName,
    });
    return { status: true, data: result };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an export history item' })
  async updateExport(
    @Req() req: any,
    @Param('id') exportId: string,
    @Body() dto: UpdateExportDto,
  ) {
    const userId = req.user?.userId || req.user?.id;
    const result = await this.service.updateExport(userId, exportId, dto);
    return { status: true, data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an export history item' })
  async deleteExport(@Req() req: any, @Param('id') exportId: string) {
    const userId = req.user?.userId || req.user?.id;
    await this.service.deleteExport(userId, exportId);
    return { status: true, message: 'Export deleted successfully' };
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download or stream an export history item' })
  async downloadExport(
    @Req() req: any,
    @Param('id') exportId: string,
    @Res() res: any,
    @Query('inline') inline?: string,
  ) {
    const userId = req.user?.userId || req.user?.id;
    const isInline = inline === 'true';
    try {
      await this.service.downloadExport(userId, exportId, res, { inline: isInline });
    } catch (err: any) {
      const statusCode = err?.status ?? 404;
      res.status(statusCode).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }

  @Delete('bulk')
  @ApiOperation({ summary: 'Bulk delete export history items' })
  async bulkDelete(@Req() req: any, @Body() dto: BulkDeleteDto) {
    const userId = req.user?.userId || req.user?.id;
    const result = await this.service.bulkDelete(userId, dto.ids);
    return { status: true, data: result };
  }

  @Patch('bulk/move')
  @ApiOperation({ summary: 'Bulk move export history items to a folder' })
  async bulkMove(@Req() req: any, @Body() dto: BulkMoveDto) {
    const userId = req.user?.userId || req.user?.id;
    const result = await this.service.bulkMove(userId, dto.ids, dto.folderId);
    return { status: true, data: result };
  }

  @Patch('bulk/rename')
  @ApiOperation({ summary: 'Bulk sequential rename of export history items' })
  async bulkRename(@Req() req: any, @Body() dto: BulkRenameDto) {
    const userId = req.user?.userId || req.user?.id;
    const result = await this.service.bulkRename(userId, dto.ids, dto.baseName);
    return { status: true, data: result };
  }
}
