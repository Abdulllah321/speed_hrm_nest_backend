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
import { SalesmanService } from './salesman.service';
import { CreateSalesmanDto, UpdateSalesmanDto } from './dto/salesman-dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Salesman')
@Controller('api/salesmen')
export class SalesmanController {
  constructor(private readonly salesmanService: SalesmanService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create salesman' })
  create(@Body() createDto: CreateSalesmanDto, @Req() req) {
    return this.salesmanService.create(createDto, req.user.userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all salesmen' })
  findAll() {
    return this.salesmanService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get salesman by id' })
  findOne(@Param('id') id: string) {
    return this.salesmanService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update salesman' })
  update(@Param('id') id: string, @Body() updateDto: UpdateSalesmanDto) {
    return this.salesmanService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete salesman' })
  remove(@Param('id') id: string) {
    return this.salesmanService.remove(id);
  }
}
