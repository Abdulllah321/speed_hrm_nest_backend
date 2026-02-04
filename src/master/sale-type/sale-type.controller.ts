import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';
import { SaleTypeService } from './sale-type.service';
import { CreateSaleTypeDto, UpdateSaleTypeDto } from './dto/sale-type-dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Sale Type')
@Controller('api/sale-types')
export class SaleTypeController {
  constructor(private readonly saleTypeService: SaleTypeService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create sale type' })
  create(@Body() createDto: CreateSaleTypeDto, @Req() req) {
    return this.saleTypeService.create(createDto, req.user.userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all sale types' })
  findAll() {
    return this.saleTypeService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get sale type by id' })
  findOne(@Param('id') id: string) {
    return this.saleTypeService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update sale type' })
  update(@Param('id') id: string, @Body() updateDto: UpdateSaleTypeDto) {
    return this.saleTypeService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete sale type' })
  remove(@Param('id') id: string) {
    return this.saleTypeService.remove(id);
  }
}
