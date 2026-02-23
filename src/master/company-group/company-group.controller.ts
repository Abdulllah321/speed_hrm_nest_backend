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
import { CompanyGroupService } from './company-group.service';
import {
  CreateCompanyGroupDto,
  UpdateCompanyGroupDto,
} from './dto/company-group-dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Company Group')
@Controller('api/company-groups')
export class CompanyGroupController {
  constructor(private readonly companyGroupService: CompanyGroupService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create company group' })
  create(@Body() createDto: CreateCompanyGroupDto, @Req() req) {
    return this.companyGroupService.create(createDto, req.user.userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all company groups' })
  findAll() {
    return this.companyGroupService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get company group by id' })
  findOne(@Param('id') id: string) {
    return this.companyGroupService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update company group' })
  update(@Param('id') id: string, @Body() updateDto: UpdateCompanyGroupDto) {
    return this.companyGroupService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete company group' })
  remove(@Param('id') id: string) {
    return this.companyGroupService.remove(id);
  }
}
