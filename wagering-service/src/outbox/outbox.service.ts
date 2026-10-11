
import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { OutboxEvent } from './outbox-event.entity.js';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  IntegrationEvent,
} from './integration-event.js';

export interface EnqueueTransactionEvent {
  transactionId: string;
  walletId: string;
  playerId: string;
  type: string;
  amount: string;
  currency: string;
  status: string;
  failureCode?: string;
}

@Injectable()
export class OutboxService {
  constructor(private readonly em: EntityManager) {}

  async enqueueTransaction(
    event: EnqueueTransactionEvent,
    em: EntityManager = this.em,
  ): Promise<OutboxEvent> {
    const data = {
      transactionId: event.transactionId,
      walletId: event.walletId,
      playerId: event.playerId,
      type: event.type,
      money: { amount: event.amount, currency: event.currency },
      status: event.status,
      ...(event.failureCode ? { failureCode: event.failureCode } : {}),
    };
    const integrationEvent = event.status === 'REJECTED'
      ? WagerTransactionRejected.create(event.walletId, event.transactionId, data)
      : event.status === 'PENDING_REFERENCE'
        ? WagerTransactionPendingReference.create(event.walletId, event.transactionId, data)
        : WagerTransactionProcessed.create(event.walletId, event.transactionId, data);
    return this.persistEvent(integrationEvent, em);
  }

  private async persistEvent(event: IntegrationEvent<Record<string, unknown>>, em: EntityManager) {
    const record = em.create(OutboxEvent, {
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      payload: event.toJSON(),
      status: 'PENDING',
      attempts: 0,
      createdAt: event.occurredAt,
    });

    await em.persist(record).flush();

    return record;
  }

  async enqueueBalanceChanged(event: {
    transactionId: string; walletId: string; direction: 'CREDIT' | 'DEBIT';
    amount: string; currency: string; balanceBefore: string; balanceAfter: string;
    walletVersion: number;
  }, em: EntityManager = this.em): Promise<OutboxEvent> {
    const integrationEvent = WalletBalanceChanged.create(event.walletId, event.transactionId, {
      walletId: event.walletId, transactionId: event.transactionId,
      direction: event.direction,
      money: { amount: event.amount, currency: event.currency },
      balanceBefore: { amount: event.balanceBefore, currency: event.currency },
      balanceAfter: { amount: event.balanceAfter, currency: event.currency },
      walletVersion: event.walletVersion,
    });
    return this.persistEvent(integrationEvent, em);
  }
}
