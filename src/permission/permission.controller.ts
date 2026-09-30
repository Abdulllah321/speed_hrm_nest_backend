import { Controller, Get, UseGuards } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Permissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/permissions')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  @ApiOperation({ summary: 'Get all permissions' })
  findAll() {
    return this.permissionService.findAll();
  }
}
