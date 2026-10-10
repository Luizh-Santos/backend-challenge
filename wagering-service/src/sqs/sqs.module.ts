
import { Module } from '@nestjs/common';
import { SqsService } from './sqs.service.js';


@Module({
  providers: [SqsService],
  exports: [SqsService],

})
export class SqsModule {}
