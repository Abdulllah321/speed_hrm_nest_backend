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
import { SalePoolService } from './sale-pool.service';
import { CreateSalePoolDto, UpdateSalePoolDto } from './dto/sale-pool-dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Sale Pool')
@Controller('api/sale-pools')
export class SalePoolController {
  constructor(private readonly salePoolService: SalePoolService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create sale pool' })
  create(@Body() createDto: CreateSalePoolDto, @Req() req) {
    return this.salePoolService.create(createDto, req.user.userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all sale pools' })
  findAll() {
    return this.salePoolService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get sale pool by id' })
  findOne(@Param('id') id: string) {
    return this.salePoolService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update sale pool' })
  update(@Param('id') id: string, @Body() updateDto: UpdateSalePoolDto) {
    return this.salePoolService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete sale pool' })
  remove(@Param('id') id: string) {
    return this.salePoolService.remove(id);
  }
}
