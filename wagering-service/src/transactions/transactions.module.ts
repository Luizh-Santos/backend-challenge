
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { Transaction } from './transaction.entity.js';
import { TransactionsService } from './transaction.service.js';
import { TransactionsController } from './transactions.controller.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([Transaction]),
    LedgerModule,
    OutboxModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
