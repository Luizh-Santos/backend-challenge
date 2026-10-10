
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { SqsService } from '../sqs/sqs.service.js';
import { InboxService } from './inbox.service.js';

@Injectable()
export class InboxConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InboxConsumerService.name);
  private stopping = false;

  constructor(
    private readonly sqsService: SqsService,
    private readonly inboxService: InboxService,
  ) {}

  onModuleInit(): void {
    void this.poll();
  }

  onModuleDestroy(): void {
    this.stopping = true;
  }

  private async poll(): Promise<void> {
    while (!this.stopping) {
      try {
        const messages = await this.sqsService.receiveMessages();

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

            const isNew = await this.inboxService.recordMessage(
              payload as Record<string, unknown>,
            );

            // Só confirma a mensagem depois de o registro no banco concluir.
            await this.sqsService.deleteMessage(message.ReceiptHandle);

            this.logger.log(
              isNew
                ? 'Mensagem registrada na Inbox e removida da fila'
                : 'Mensagem duplicada reconhecida e removida da fila',
            );
          } catch (error) {
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
