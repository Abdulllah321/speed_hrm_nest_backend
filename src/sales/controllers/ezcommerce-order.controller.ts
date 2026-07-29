import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { EzcommerceOrderService } from '../services/ezcommerce-order.service';
import { EzcommerceConfirmOrderDto } from '../dto/ezcommerce-order.dto';
import { HmacAuthGuard } from '../../common/guards/hmac-auth.guard';

@ApiTags('EZCommerce Integration')
@Controller('api/integrations/ezcommerce')
export class EzcommerceOrderController {
  constructor(
    private readonly ezcommerceOrderService: EzcommerceOrderService,
  ) {}

  @Post('orders/confirm')
  @UseGuards(HmacAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Receive confirmed orders from EZCommerce, create order record, and deduct stock per BarCode',
  })
  async confirmOrder(@Body() dto: EzcommerceConfirmOrderDto) {
    return this.ezcommerceOrderService.createConfirmedOrder(dto);
  }
}
