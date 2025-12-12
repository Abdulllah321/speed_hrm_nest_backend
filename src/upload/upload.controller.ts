import { Controller, Post, Req, Get, Param, Res, Delete, UseGuards } from '@nestjs/common';
import { UploadService } from './upload.service';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('api')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  async uploadSingleFile(@Req() request: FastifyRequest) {
    const data = await request.file();
    if (!data) {
      return { status: false, message: 'No file provided' };
    }
    const createdById = request.user?.userId || null;
    return this.uploadService.uploadFile(data, createdById);
  }

  @Post('uploads/multiple')
  @UseGuards(JwtAuthGuard)
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

  @Get('uploads')
  @UseGuards(JwtAuthGuard)
  async listUploads() {
    return this.uploadService.listUploads();
  }

  @Get('uploads/:id')
  @UseGuards(JwtAuthGuard)
  async getUpload(@Param('id') id: string) {
    return this.uploadService.getUpload(id);
  }

  @Get('uploads/download/:id')
  @UseGuards(JwtAuthGuard)
  async downloadUpload(@Param('id') id: string, @Res() reply: FastifyReply) {
    const { item, stream } = await this.uploadService.downloadUpload(id);
    reply.header('Content-Type', item.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${item.filename}"`);
    return reply.send(stream);
  }

  @Delete('uploads/:id')
  @UseGuards(JwtAuthGuard)
  async deleteUpload(@Param('id') id: string) {
    return this.uploadService.deleteUpload(id);
  }
}
