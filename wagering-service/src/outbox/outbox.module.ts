
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { OutboxEvent } from './outbox-event.entity.js';
import { OutboxService } from './outbox.service.js';
import { OutboxPublisherService } from './outbox-publisher.service.js';
import { SqsModule } from '../sqs/sqs.module.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([OutboxEvent]),
    SqsModule,
  ],
  providers: [
    OutboxService,
    OutboxPublisherService,
  ],
  exports: [OutboxService],
})
export class OutboxModule {}
