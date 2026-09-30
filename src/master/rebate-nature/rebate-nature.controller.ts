import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { RebateNatureService } from './rebate-nature.service';
import { CreateRebateNatureDto } from './dto/create-rebate-nature.dto';
import { UpdateRebateNatureDto } from './dto/update-rebate-nature.dto';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Rebate Nature')
@Controller('api/rebate-nature')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class RebateNatureController {
  constructor(private readonly rebateNatureService: RebateNatureService) {}

  @Post()
  @Permissions('hr.rebate-nature.create')
  @ApiOperation({ summary: 'Create a new rebate nature' })
  @ApiResponse({
    status: 201,
    description: 'Rebate nature created successfully.',
  })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  create(@Body() createRebateNatureDto: CreateRebateNatureDto, @Request() req) {
    return this.rebateNatureService.create(createRebateNatureDto, req.user.id);
  }

  @Get('fixed/grouped')
  @Permissions('hr.rebate-nature.read')
  @ApiOperation({ summary: 'Get fixed rebate natures grouped by category' })
  @ApiResponse({
    status: 200,
    description: 'Return fixed rebate natures grouped by category.',
  })
  findFixedGrouped() {
    return this.rebateNatureService.findFixedRebateNatures();
  }

  @Get()
  @Permissions('hr.rebate-nature.read')
  @ApiOperation({ summary: 'Get all rebate natures or filter by type' })
  @ApiResponse({
    status: 200,
    description: 'Return all rebate natures or filtered by type.',
  })
  findAll(@Query('type') type?: string) {
    if (type === 'fixed' || type === 'other') {
      return this.rebateNatureService.findAllByType(type);
    }
    return this.rebateNatureService.findAll();
  }

  @Get(':id')
  @Permissions('hr.rebate-nature.read')
  @ApiOperation({ summary: 'Get a rebate nature by id' })
  @ApiResponse({ status: 200, description: 'Return the rebate nature.' })
  @ApiResponse({ status: 404, description: 'Rebate nature not found.' })
  findOne(@Param('id') id: string) {
    return this.rebateNatureService.findOne(id);
  }

  @Patch(':id')
  @Permissions('hr.rebate-nature.update')
  @ApiOperation({ summary: 'Update a rebate nature' })
  @ApiResponse({
    status: 200,
    description: 'Rebate nature updated successfully.',
  })
  @ApiResponse({ status: 404, description: 'Rebate nature not found.' })
  update(
    @Param('id') id: string,
    @Body() updateRebateNatureDto: UpdateRebateNatureDto,
  ) {
    return this.rebateNatureService.update(id, updateRebateNatureDto);
  }

  @Delete(':id')
  @Permissions('hr.rebate-nature.delete')
  @ApiOperation({ summary: 'Delete a rebate nature' })
  @ApiResponse({
    status: 200,
    description: 'Rebate nature deleted successfully.',
  })
  @ApiResponse({ status: 404, description: 'Rebate nature not found.' })
  remove(@Param('id') id: string) {
    return this.rebateNatureService.remove(id);
  }
}
