import { Controller, Post, Req, Get, Param, Res, Delete, UseGuards } from '@nestjs/common';
import { UploadService } from './upload.service';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { MultipartFile } from 'fastify-multipart';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('single')
  async uploadSingleFile(@Req() request: FastifyRequest) {
    const data = await request.file();
    // Assuming req.user is available from an authentication guard
    const createdById = request.user?.userId || null; 
    return this.uploadService.uploadFile(data, createdById);
  }

  @Post('multiple')
  async uploadMultipleFiles(@Req() request: FastifyRequest) {
    const parts = request.parts();
    const files: MultipartFile[] = [];
    for await (const part of parts) {
      // Type guard to check if part is a file
      if ('type' in part && part.type === 'file') {
        files.push(part as MultipartFile);
      }
    }
    const createdById = request.user?.userId || null;
    return this.uploadService.uploadMultiple(files, createdById);
  }

  @Get()
  async listUploads() {
    return this.uploadService.listUploads();
  }

  @Get(':id')
  async getUpload(@Param('id') id: string) {
    return this.uploadService.getUpload(id);
  }

  @Get('download/:id')
  async downloadUpload(@Param('id') id: string, @Res() reply: FastifyReply) {
    const { item, stream } = await this.uploadService.downloadUpload(id);
    reply.header('Content-Type', item.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${item.filename}"`);
    return reply.send(stream);
  }

  @Delete(':id')
  async deleteUpload(@Param('id') id: string) {
    return this.uploadService.deleteUpload(id);
  }
}
