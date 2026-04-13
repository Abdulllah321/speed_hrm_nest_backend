import { Controller, Get, Post, Body, Put, Param, Delete, UseGuards } from '@nestjs/common';
import { HsCodeService } from './hs-code.service';
import { CreateHsCodeDto, UpdateHsCodeDto } from './hs-code.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';

@Controller('api')
export class HsCodeController {
    constructor(private readonly hsCodeService: HsCodeService) { }

    @Post('hs-codes')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.create'))
    create(@Body() dto: CreateHsCodeDto) {
        return this.hsCodeService.create(dto);
    }

    @Get('hs-codes')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.read'))
    list() {
        return this.hsCodeService.list();
    }

    @Get('hs-codes/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.read'))
    get(@Param('id') id: string) {
        return this.hsCodeService.get(id);
    }

    @Put('hs-codes/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.update'))
    update(@Param('id') id: string, @Body() dto: UpdateHsCodeDto) {
        return this.hsCodeService.update(id, dto);
    }

    @Delete('hs-codes/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.delete'))
    remove(@Param('id') id: string) {
        return this.hsCodeService.remove(id);
    }
}
