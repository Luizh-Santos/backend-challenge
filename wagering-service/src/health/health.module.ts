import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SqsModule } from '../sqs/sqs.module.js';
import { SqsService } from '../sqs/sqs.service.js';

@Controller('health')
class HealthController {
  constructor(private readonly em: EntityManager, private readonly sqs: SqsService) {}
  @Get('live') live() { return { status: 'ok' }; }

  @Get('ready')
  async ready() {
    try {
      await this.em.getConnection().execute('select 1');
      await this.sqs.checkReady();
      return { status: 'ready', dependencies: { postgres: 'ok', sqs: 'ok' } };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready', dependencies: { postgres: 'unknown', sqs: 'unknown' },
      });
    }
  }
}

@Module({ imports: [SqsModule], controllers: [HealthController] })
export class HealthModule {}
