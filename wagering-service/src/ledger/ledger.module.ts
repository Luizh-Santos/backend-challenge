
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { LedgerEntry } from './ledger-entry.entity.js';
import { LedgerService } from './ledger.service.js';
import { LedgerController } from './ledger.controller.js';

@Module({
  imports: [MikroOrmModule.forFeature([LedgerEntry])],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
