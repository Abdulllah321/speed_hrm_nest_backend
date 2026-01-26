import { Controller, Post, Body, Get, Param, UseGuards, Req } from '@nestjs/common';
import { TransferService } from './transfer.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
// Assuming RBAC or Permission guard exists, add later if needed.

@Controller('api')
@UseGuards(JwtAuthGuard)
export class TransferController {
    constructor(private readonly transferService: TransferService) { }

    @Post('employee-transfer')
    create(@Body() createTransferDto: CreateTransferDto, @Req() req: any) {
        return this.transferService.create(createTransferDto, req.user.id);
    }

    @Get('employee-transfer/employee/:id')
    findAll(@Param('id') id: string) {
        return this.transferService.findAll(id);
    }
}
