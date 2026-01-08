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
import { EmployeeService } from './employee.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { FastifyRequest } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/create-employee.dto';

@ApiTags('Employee')
@Controller('api')
export class EmployeeController {
  constructor(private service: EmployeeService) {}

  @Get('employees')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all employees' })
  async list() {
    return this.service.list();
  }

  @Get('employees/for-attendance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List employees for attendance' })
  async listForAttendance(
    @Query('departmentId') departmentId?: string,
    @Query('subDepartmentId') subDepartmentId?: string,
  ) {
    return this.service.listForAttendance({ departmentId, subDepartmentId });
  }

  @Get('employees/dropdown')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List employees for dropdown' })
  async listForDropdown() {
    return this.service.listForDropdown();
  }

  @Get('employees/rejoin/search')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search employee for rejoin' })
  async searchForRejoin(@Query('cnic') cnic: string) {
    if (!cnic) {
      return { status: false, message: 'CNIC is required' };
    }
    return this.service.findByCnicForRejoin(cnic);
  }

  @Post('employees/rejoin')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rejoin employee' })
  async rejoinEmployee(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    const cnic = body.cnic as string | undefined;
    if (!cnic) {
      return { status: false, message: 'CNIC is required' };
    }
    return this.service.rejoinEmployee(cnic, body, {
      userId: (req.user as any)?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('employees/:id/rejoining-history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get rejoining history' })
  async getRejoiningHistory(@Param('id') id: string) {
    return this.service.getRejoiningHistory(id);
  }

  @Get('employees/:id/historical-state')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get historical state' })
  async getHistoricalState(
    @Param('id') id: string,
    @Query('beforeDate') beforeDate?: string,
  ) {
    const date = beforeDate ? new Date(beforeDate) : undefined;
    return this.service.getHistoricalState(id, date);
  }

  @Get('employees/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get employee details' })
  async get(
    @Param('id') id: string,
    @Query('includeHistory') includeHistory?: string,
  ) {
    // GET /employees/:id?includeHistory=true to include rejoin summary
    return this.service.get(id, includeHistory === 'true');
  }

  @Post('employees')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create employee' })
  async create(@Body() body: CreateEmployeeDto, @Req() req: FastifyRequest) {
    return this.service.create(body, {
      userId: (req.user as any)?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('employees/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update employee' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateEmployeeDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.update(id, body as any, {
      userId: (req.user as any)?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('employees/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete employee' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.service.remove(id, {
      userId: (req.user as any)?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('employees/import-csv')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
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
  @ApiOperation({ summary: 'Import employees from CSV/Excel' })
  async importCsv(@Req() request: FastifyRequest) {
    const data = await request.file();
    if (!data) {
      return { status: false, message: 'No file provided' };
    }

    // Validate file extension
    const fileExtension = path.extname(data.filename).toLowerCase();
    if (fileExtension !== '.csv' && fileExtension !== '.xlsx') {
      return {
        status: false,
        message:
          'Invalid file format. Please upload a CSV (.csv) or Excel (.xlsx) file',
      };
    }

    // Save file temporarily
    const uploadRoot = path.join(process.cwd(), 'public', 'csv');
    if (!fs.existsSync(uploadRoot)) {
      fs.mkdirSync(uploadRoot, { recursive: true });
    }

    const ts = Date.now();
    const safeFilename = data.filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filename = `${ts}_${safeFilename}`;
    const fullPath = path.join(uploadRoot, filename);

    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(fullPath);
      data.file.pipe(writeStream);
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
    });

    try {
      // Extract userId from JWT token (could be 'sub', 'id', or 'userId')
      const user = request.user as any;
      const userId = user?.userId || user?.sub || user?.id || null;
      
      const result = await this.service.bulkUploadFromCSV(fullPath, {
        userId: userId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      // Clean up file after processing
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // Failed to delete temp file
      }

      return result;
    } catch (error: any) {
      // Clean up file on error
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // Failed to delete temp file
      }
      let errorMessage = 'Failed to process file';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error
      ) {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string') {
          errorMessage = message;
        }
      }
      return {
        status: false,
        message: errorMessage,
      };
    }
  }
}
