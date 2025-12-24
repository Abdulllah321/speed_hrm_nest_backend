import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { RebateNatureService } from './rebate-nature.service';
import { CreateRebateNatureDto } from './dto/create-rebate-nature.dto';
import { UpdateRebateNatureDto } from './dto/update-rebate-nature.dto';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@ApiTags('Rebate Nature')
@Controller('rebate-nature')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()

export class RebateNatureController {
  constructor(private readonly rebateNatureService: RebateNatureService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new rebate nature' })
  @ApiResponse({ status: 201, description: 'Rebate nature created successfully.' })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  create(@Body() createRebateNatureDto: CreateRebateNatureDto, @Request() req) {
    return this.rebateNatureService.create(createRebateNatureDto, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all rebate natures' })
  @ApiResponse({ status: 200, description: 'Return all rebate natures.' })
  findAll() {
    return this.rebateNatureService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a rebate nature by id' })
  @ApiResponse({ status: 200, description: 'Return the rebate nature.' })
  @ApiResponse({ status: 404, description: 'Rebate nature not found.' })
  findOne(@Param('id') id: string) {
    return this.rebateNatureService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a rebate nature' })
  @ApiResponse({ status: 200, description: 'Rebate nature updated successfully.' })
  @ApiResponse({ status: 404, description: 'Rebate nature not found.' })
  update(
    @Param('id') id: string,
    @Body() updateRebateNatureDto: UpdateRebateNatureDto,
  ) {
    return this.rebateNatureService.update(id, updateRebateNatureDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a rebate nature' })
  @ApiResponse({ status: 200, description: 'Rebate nature deleted successfully.' })
  @ApiResponse({ status: 404, description: 'Rebate nature not found.' })
  remove(@Param('id') id: string) {
    return this.rebateNatureService.remove(id);
  }
}
