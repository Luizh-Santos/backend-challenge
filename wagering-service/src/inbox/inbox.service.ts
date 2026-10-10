
import {
  Injectable,
} from '@nestjs/common';
import {
  EntityManager,
  UniqueConstraintViolationException,
} from '@mikro-orm/postgresql';

import { InboxEvent } from './inbox-event.entity.js';

@Injectable()
export class InboxService {
  constructor(private readonly em: EntityManager) {}

  async recordMessage(
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const eventId = payload.transactionId;
    const eventType = 'WAGER_TRANSACTION_PROCESSED';

    if (typeof eventId !== 'string' || !eventId.trim()) {
      throw new Error('Mensagem SQS sem transactionId válido');
    }

    try {
      return await this.em.transactional(async (tx) => {
        const existing = await tx.findOne(InboxEvent, { eventId });

        if (existing) {
          return false;
        }

        const now = new Date();

        const event = tx.create(InboxEvent, {
          eventId,
          eventType,
          payload,
          status: 'PROCESSED',
          receivedAt: now,
          processedAt: now,
        });

        await tx.persist(event).flush();

        return true;
      });
    } catch (error) {
      // Se outra instância registrou o evento primeiro, a restrição
      // UNIQUE garante que ele não seja duplicado.
      if (error instanceof UniqueConstraintViolationException) {
        return false;
      }

      throw error;
    }
  }
}
