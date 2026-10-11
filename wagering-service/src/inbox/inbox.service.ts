
import {
  Injectable,
} from '@nestjs/common';
import {
  EntityManager,
} from '@mikro-orm/postgresql';
import { createHash } from 'node:crypto';

import { InboxEvent } from './inbox-event.entity.js';

@Injectable()
export class InboxService {
  constructor(private readonly em: EntityManager) {}

  async recordMessage(
    messageIdOrPayload: string | Record<string, unknown>,
    payloadArg?: Record<string, unknown>,
    processArg?: (tx: EntityManager) => Promise<unknown>,
  ): Promise<boolean> {
    const payload = typeof messageIdOrPayload === 'string' ? payloadArg! : messageIdOrPayload;
    const messageId = typeof messageIdOrPayload === 'string'
      ? messageIdOrPayload
      : String(messageIdOrPayload.transactionId ?? 'legacy-message');
    const process = processArg ?? (async () => undefined);
    if (!messageId.trim()) throw new Error('Mensagem SQS sem MessageId válido');
    const eventId = `wager-transaction-consumer:${messageId}`;
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const eventType = 'WagerTransactionRequested';

    return this.em.transactional(async (tx) => {
        const existing = await tx.findOne(InboxEvent, {
          consumerName: 'wager-transaction-consumer', messageId,
        });

        if (existing) {
          if (existing.payloadHash !== payloadHash) throw new Error('MessageId reutilizado com payload diferente');
          return false;
        }

        const now = new Date();

        const event = tx.create(InboxEvent, {
          eventId,
          consumerName: 'wager-transaction-consumer',
          messageId,
          payloadHash,
          eventType,
          payload,
          status: 'PROCESSED',
          receivedAt: now,
          processedAt: now,
        });

        await tx.persist(event).flush();
        await process(tx);
        await tx.flush();

        return true;
    });
  }
}
