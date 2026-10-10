
import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { OutboxEvent } from './outbox-event.entity.js';

export interface EnqueueTransactionEvent {
  transactionId: string;
  walletId: string;
  playerId: string;
  type: string;
  amount: string;
  currency: string;
  status: string;
}

@Injectable()
export class OutboxService {
  constructor(private readonly em: EntityManager) {}

  async enqueueTransaction(
    event: EnqueueTransactionEvent,
    em: EntityManager = this.em,
  ): Promise<OutboxEvent> {
    const record = em.create(OutboxEvent, {
      eventType: 'WAGER_TRANSACTION_PROCESSED',
      aggregateId: event.walletId,
      payload: {
        transactionId: event.transactionId,
        walletId: event.walletId,
        playerId: event.playerId,
        type: event.type,
        amount: event.amount,
        currency: event.currency,
        status: event.status,
      },
      status: 'PENDING',
      attempts: 0,
      createdAt: new Date(),
    });

    await em.persist(record).flush();

    return record;
  }
}
