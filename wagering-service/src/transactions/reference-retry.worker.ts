import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TransactionsService } from './transaction.service.js';
import { MetricsService } from '../observability/metrics.service.js';

@Injectable()
export class ReferenceRetryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReferenceRetryWorker.name);
  private stopping = false;
  private running?: Promise<void>;
  constructor(private readonly transactions: TransactionsService, private readonly metrics: MetricsService) {}
  onModuleInit(): void { this.running = this.poll(); }
  async onModuleDestroy(): Promise<void> { this.stopping = true; await this.running; }
  private async poll(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.transactions.retryPendingReferences();
        this.metrics.increment('wager_reference_retries_total');
      }
      catch (error) {
        this.logger.error('Falha no reprocessamento de referências pendentes',
          error instanceof Error ? error.stack : String(error));
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
