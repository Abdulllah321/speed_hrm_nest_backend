import { Controller, Post, Req, Get, Param, Res, Delete, UseGuards } from '@nestjs/common';
import { UploadService } from './upload.service';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';

@ApiTags('Upload')
@Controller('api')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload a single file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload multiple files' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all uploads' })
  async listUploads() {
    return this.uploadService.listUploads();
  }

  @Get('uploads/:id')
  @ApiOperation({ summary: 'View upload (image)' })
  // Public endpoint for viewing images (no auth required)
  async getUpload(@Param('id') id: string, @Res() reply: FastifyReply) {
    try {
      const item = await this.uploadService.getUpload(id);
      if (!item || !item.path) {
        return reply.status(404).send({ status: false, message: 'File not found' });
      }
      
      const { stream } = await this.uploadService.downloadUpload(id);
      reply.header('Content-Type', item.mimetype);
      reply.header('Content-Disposition', `inline; filename="${item.filename}"`);
      reply.header('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      return reply.send(stream);
    } catch (error: any) {
      return reply.status(404).send({ status: false, message: 'File not found' });
    }
  }

  @Get('uploads/download/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Download upload file' })
  async downloadUpload(@Param('id') id: string, @Res() reply: FastifyReply) {
    const { item, stream } = await this.uploadService.downloadUpload(id);
    reply.header('Content-Type', item.mimetype);
    reply.header('Content-Disposition', `attachment; filename="${item.filename}"`);
    return reply.send(stream);
  }

  @Delete('uploads/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete upload' })
  async deleteUpload(@Param('id') id: string) {
    return this.uploadService.deleteUpload(id);
  }
}
