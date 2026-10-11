
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { SqsService } from '../sqs/sqs.service.js';
import { InboxService } from './inbox.service.js';
import { TransactionsService } from '../transactions/transaction.service.js';
import { CreateTransactionDto } from '../transactions/create-transaction.dto.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MetricsService } from '../observability/metrics.service.js';

@Injectable()
export class InboxConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InboxConsumerService.name);
  private stopping = false;
  private running?: Promise<void>;

  constructor(
    private readonly sqsService: SqsService,
    private readonly inboxService: InboxService,
    private readonly transactionsService: TransactionsService,
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
        const messages = await this.sqsService.receiveMessages();
        this.metrics.setGauge('wager_dlq_messages', await this.sqsService.getDlqDepth());

        for (const message of messages) {
          if (this.stopping) break;

          try {
            if (!message.Body || !message.ReceiptHandle) {
              throw new Error('Mensagem SQS sem corpo ou ReceiptHandle');
            }

            const payload: unknown = JSON.parse(message.Body);

            if (
              typeof payload !== 'object' ||
              payload === null ||
              Array.isArray(payload)
            ) {
              throw new Error('Corpo da mensagem não é um objeto válido');
            }

            const envelope = payload as Record<string, unknown>;
            if (envelope.type !== 'WagerTransactionRequested' || !envelope.data || typeof envelope.data !== 'object') {
              throw new Error('Mensagem não corresponde a WagerTransactionRequested');
            }
            const data = envelope.data as Record<string, unknown>;
            const money = data.money as Record<string, unknown> | undefined;
            const rawInput = {
              providerId: data.providerId,
              externalTransactionId: data.externalTransactionId,
              walletId: data.walletId,
              playerId: data.playerId,
              roundId: data.roundId,
              gameId: data.gameId,
              type: data.kind,
              amount: money?.amount,
              currency: money?.currency,
              externalReferenceTransactionId: data.referenceExternalTransactionId,
            };
            const input = plainToInstance(CreateTransactionDto, rawInput);
            const validationErrors = await validate(input);
            if (validationErrors.length) throw new Error('Payload de transação inválido');
            const idempotencyKey = typeof data.idempotencyKey === 'string'
              ? data.idempotencyKey
              : `${String(data.providerId)}:${String(data.externalTransactionId)}`;
            const isNew = await this.inboxService.recordMessage(
              message.MessageId ?? '', envelope,
              (tx) => this.transactionsService.processTransaction(input, idempotencyKey, tx),
            );

            // Só confirma a mensagem depois de o registro no banco concluir.
            await this.sqsService.deleteMessage(message.ReceiptHandle);

            this.logger.log(JSON.stringify({
              event: isNew ? 'sqs_message_processed' : 'sqs_message_duplicate',
              correlationId: data.transactionId,
              messageId: message.MessageId,
              transactionId: data.externalTransactionId,
              walletId: data.walletId,
              providerId: data.providerId,
            }));
          } catch (error) {
            this.metrics.increment('wager_message_retries_total');
            this.logger.error(
              'Falha ao processar mensagem SQS; ela poderá ser entregue novamente',
              error instanceof Error ? error.stack : String(error),
            );
          }
        }
      } catch (error) {
        this.logger.error(
          'Falha ao consultar a fila SQS',
          error instanceof Error ? error.stack : String(error),
        );

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
}
