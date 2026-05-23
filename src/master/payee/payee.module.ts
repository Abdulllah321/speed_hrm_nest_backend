import { Module } from '@nestjs/common';
import { PayeeController } from './payee.controller';
import { PayeeService } from './payee.service';

@Module({
  controllers: [PayeeController],
  providers: [PayeeService]
})
export class PayeeModule {}
