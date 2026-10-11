
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SqsService } from '../sqs/sqs.service.js';
import { MetricsService } from '../observability/metrics.service.js';

interface ClaimedOutboxRow {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

@Injectable()
export class OutboxPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxPublisherService.name);
  private stopping = false;
  private running?: Promise<void>;

  constructor(
    private readonly em: EntityManager,
    private readonly sqsService: SqsService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.running = this.poll();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.running;
  }

  private async poll(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.publishBatch();
      } catch (error) {
        this.logger.error(
          'Falha ao processar a Outbox',
          error instanceof Error ? error.stack : String(error),
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  private async publishBatch(): Promise<void> {
    const db = this.em.fork();

    // SKIP LOCKED permite que múltiplos publicadores
    // selecionem eventos diferentes.
    const rows = await db.transactional(async (tx) => {
      return tx.getConnection().execute<ClaimedOutboxRow[]>(`
        WITH candidates AS (
          SELECT id
          FROM outbox_events
          WHERE
            (
              status = 'PENDING'
              AND (
                next_attempt_at IS NULL
                OR next_attempt_at <= now()
              )
            )
            OR (
              status = 'PROCESSING'
              AND next_attempt_at <= now()
            )
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 10
        )
        UPDATE outbox_events AS e
        SET
          status = 'PROCESSING',
          attempts = e.attempts + 1,
          next_attempt_at = now() + interval '60 seconds'
        FROM candidates
        WHERE e.id = candidates.id
        RETURNING
          e.id,
          e.event_type,
          e.aggregate_id,
          e.payload,
          e.attempts
      `);
    });
    const lag = await db.getConnection().execute<Array<{ lag: number }>>(
      `select coalesce(extract(epoch from (now() - min(created_at))) * 1000, 0)::int as lag from outbox_events where status = 'PENDING'`,
    );
    this.metrics.setGauge('wager_outbox_lag_ms', Number(lag[0]?.lag ?? 0));

    for (const row of rows) {
      try {
        await this.sqsService.publishTransaction(
          row.payload,
          row.aggregate_id,
          row.id,
        );

        await db.getConnection().execute(
          `UPDATE outbox_events
           SET status = 'PUBLISHED',
               published_at = now(),
               next_attempt_at = NULL,
               last_error = NULL
           WHERE id = ?`,
          [row.id],
        );

        this.logger.log(JSON.stringify({
          event: 'outbox_event_published', eventId: row.id,
          eventType: row.event_type, aggregateId: row.aggregate_id,
        }));
      } catch (error) {
        this.metrics.increment('wager_outbox_retries_total');
        const message = (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 255);

        const delaySeconds = Math.min(
          300,
          2 ** Math.min(row.attempts, 8),
        );

        await db.getConnection().execute(
          `UPDATE outbox_events
           SET status = 'PENDING',
               next_attempt_at = now() + (? * interval '1 second'),
               last_error = ?
           WHERE id = ?`,
          [delaySeconds, message, row.id],
        );

        this.logger.warn(
          `Evento ${row.id} falhou; nova tentativa em ${delaySeconds}s`,
        );
      }
    }
  }
}
