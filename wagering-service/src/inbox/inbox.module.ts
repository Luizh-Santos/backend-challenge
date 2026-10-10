
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { InboxEvent } from './inbox-event.entity.js';
import { InboxService } from './inbox.service.js';
import { InboxConsumerService } from './inbox-consumer.service.js';
import { SqsModule } from '../sqs/sqs.module.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([InboxEvent]),
    SqsModule,
  ],
  providers: [
    InboxService,
    InboxConsumerService,
  ],
  exports: [InboxService],
})
export class InboxModule {}
