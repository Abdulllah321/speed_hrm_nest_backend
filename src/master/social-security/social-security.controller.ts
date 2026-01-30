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
import { SocialSecurityService } from './social-security.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import {
  CreateSocialSecurityInstitutionDto,
  UpdateSocialSecurityInstitutionDto,
  CreateSocialSecurityEmployerRegistrationDto,
  UpdateSocialSecurityEmployerRegistrationDto,
  CreateSocialSecurityEmployeeRegistrationDto,
  UpdateSocialSecurityEmployeeRegistrationDto,
  CreateSocialSecurityContributionDto,
  UpdateSocialSecurityContributionDto,
} from './dto/social-security.dto';

@ApiTags('Social Security')
@Controller('api')
export class SocialSecurityController {
  constructor(private service: SocialSecurityService) {}

  // ========== Institution Endpoints ==========
  @Get('social-security-institutions')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all social security institutions' })
  async listInstitutions() {
    return this.service.listInstitutions();
  }

  @Get('social-security-institutions/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get social security institution by id' })
  async getInstitution(@Param('id') id: string) {
    return this.service.getInstitution(id);
  }

  @Post('social-security-institutions')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create social security institution' })
  async createInstitution(
    @Body() body: CreateSocialSecurityInstitutionDto,
    @Req() req: any,
  ) {
    return this.service.createInstitution(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('social-security-institutions/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update social security institution' })
  async updateInstitution(
    @Param('id') id: string,
    @Body() body: UpdateSocialSecurityInstitutionDto,
    @Req() req: any,
  ) {
    return this.service.updateInstitution(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('social-security-institutions/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete social security institution' })
  async removeInstitution(@Param('id') id: string, @Req() req: any) {
    return this.service.removeInstitution(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ========== Employer Registration Endpoints ==========
  @Get('social-security-employer-registrations')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all employer registrations' })
  @ApiQuery({
    name: 'institutionId',
    required: false,
    description: 'Filter by institution ID',
  })
  async listEmployerRegistrations(
    @Query('institutionId') institutionId?: string,
  ) {
    return this.service.listEmployerRegistrations(institutionId);
  }

  @Get('social-security-employer-registrations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get employer registration by id' })
  async getEmployerRegistration(@Param('id') id: string) {
    return this.service.getEmployerRegistration(id);
  }

  @Post('social-security-employer-registrations')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create employer registration' })
  async createEmployerRegistration(
    @Body() body: CreateSocialSecurityEmployerRegistrationDto,
    @Req() req: any,
  ) {
    return this.service.createEmployerRegistration(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('social-security-employer-registrations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update employer registration' })
  async updateEmployerRegistration(
    @Param('id') id: string,
    @Body() body: UpdateSocialSecurityEmployerRegistrationDto,
    @Req() req: any,
  ) {
    return this.service.updateEmployerRegistration(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('social-security-employer-registrations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete employer registration' })
  async removeEmployerRegistration(@Param('id') id: string, @Req() req: any) {
    return this.service.removeEmployerRegistration(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ========== Employee Registration Endpoints ==========
  @Get('social-security-employee-registrations')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all employee registrations' })
  @ApiQuery({
    name: 'employeeId',
    required: false,
    description: 'Filter by employee ID',
  })
  @ApiQuery({
    name: 'institutionId',
    required: false,
    description: 'Filter by institution ID',
  })
  @ApiQuery({
    name: 'employerRegistrationId',
    required: false,
    description: 'Filter by employer registration ID',
  })
  async listEmployeeRegistrations(
    @Query('employeeId') employeeId?: string,
    @Query('institutionId') institutionId?: string,
    @Query('employerRegistrationId') employerRegistrationId?: string,
  ) {
    return this.service.listEmployeeRegistrations(
      employeeId,
      institutionId,
      employerRegistrationId,
    );
  }

  @Get('social-security-employee-registrations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get employee registration by id' })
  async getEmployeeRegistration(@Param('id') id: string) {
    return this.service.getEmployeeRegistration(id);
  }

  @Post('social-security-employee-registrations')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create employee registration' })
  async createEmployeeRegistration(
    @Body() body: CreateSocialSecurityEmployeeRegistrationDto,
    @Req() req: any,
  ) {
    return this.service.createEmployeeRegistration(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('social-security-employee-registrations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update employee registration' })
  async updateEmployeeRegistration(
    @Param('id') id: string,
    @Body() body: UpdateSocialSecurityEmployeeRegistrationDto,
    @Req() req: any,
  ) {
    return this.service.updateEmployeeRegistration(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('social-security-employee-registrations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete employee registration' })
  async removeEmployeeRegistration(@Param('id') id: string, @Req() req: any) {
    return this.service.removeEmployeeRegistration(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ========== Contribution Endpoints ==========
  @Get('social-security-contributions')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all contributions' })
  @ApiQuery({
    name: 'employeeId',
    required: false,
    description: 'Filter by employee ID',
  })
  @ApiQuery({
    name: 'institutionId',
    required: false,
    description: 'Filter by institution ID',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'Filter by month (01-12)',
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Filter by year (YYYY)',
  })
  async listContributions(
    @Query('employeeId') employeeId?: string,
    @Query('institutionId') institutionId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.listContributions(
      employeeId,
      institutionId,
      month,
      year,
    );
  }

  @Get('social-security-contributions/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get contribution by id' })
  async getContribution(@Param('id') id: string) {
    return this.service.getContribution(id);
  }

  @Post('social-security-contributions')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create contribution' })
  async createContribution(
    @Body() body: CreateSocialSecurityContributionDto,
    @Req() req: any,
  ) {
    return this.service.createContribution(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('social-security-contributions/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update contribution' })
  async updateContribution(
    @Param('id') id: string,
    @Body() body: UpdateSocialSecurityContributionDto,
    @Req() req: any,
  ) {
    return this.service.updateContribution(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('social-security-contributions/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.social-security.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete contribution' })
  async removeContribution(@Param('id') id: string, @Req() req: any) {
    return this.service.removeContribution(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
