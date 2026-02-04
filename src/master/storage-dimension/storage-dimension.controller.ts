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
import { StorageDimensionService } from './storage-dimension.service';
import { CreateStorageDimensionDto, UpdateStorageDimensionDto } from './dto/storage-dimension-dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Storage Dimension')
@Controller('api/storage-dimensions')
export class StorageDimensionController {
    constructor(private readonly storageDimensionService: StorageDimensionService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create storage dimension' })
    create(@Body() createDto: CreateStorageDimensionDto, @Req() req) {
        return this.storageDimensionService.create(createDto, req.user.userId);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'List all storage dimensions' })
    findAll() {
        return this.storageDimensionService.findAll();
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get storage dimension by id' })
    findOne(@Param('id') id: string) {
        return this.storageDimensionService.findOne(id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update storage dimension' })
    update(@Param('id') id: string, @Body() updateDto: UpdateStorageDimensionDto) {
        return this.storageDimensionService.update(id, updateDto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Delete storage dimension' })
    remove(@Param('id') id: string) {
        return this.storageDimensionService.remove(id);
    }
}
