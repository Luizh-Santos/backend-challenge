
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import mikroOrmConfig from './mikro-orm.config.js';

import { WalletsModule } from './wallets/wallets.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { HealthModule } from './health/health.module.js';
import { SqsModule } from './sqs/sqs.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { InboxModule } from './inbox/inbox.module.js';
import { MetricsModule } from './observability/metrics.service.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
    WalletsModule,
    TransactionsModule,
    LedgerModule,
    HealthModule,
    SqsModule,
    OutboxModule,
    InboxModule,
    MetricsModule,
  ],
})
export class AppModule {}
