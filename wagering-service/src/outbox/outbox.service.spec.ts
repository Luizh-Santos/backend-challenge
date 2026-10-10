
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityManager } from '@mikro-orm/postgresql';

import { OutboxEvent } from './outbox-event.entity.js';
import { OutboxService } from './outbox.service.js';

describe('OutboxService', () => {
  let service: OutboxService;
  let em: EntityManager;
  let create: ReturnType<typeof vi.fn>;
  let persist: ReturnType<typeof vi.fn>;
  let flush: ReturnType<typeof vi.fn>;

  const event = {
    transactionId: '11111111-1111-4111-8111-111111111111',
    walletId: '22222222-2222-4222-8222-222222222222',
    playerId: 'player-test-001',
    type: 'BET',
    amount: '30.00',
    currency: 'BRL',
    status: 'PROCESSED',
  };

  function makeEntityManager() {
    flush = vi.fn().mockResolvedValue(undefined);

    create = vi.fn(
      (_entity: unknown, data: Record<string, unknown>) => data,
    );

    persist = vi.fn(() => ({ flush }));

    return {
      create,
      persist,
    } as unknown as EntityManager;
  }

  beforeEach(() => {
    em = makeEntityManager();
    service = new OutboxService(em);
  });

  it('registra um evento pendente usando o EntityManager padrão', async () => {
    const result = await service.enqueueTransaction(event);

    expect(create).toHaveBeenCalledWith(
      OutboxEvent,
      expect.objectContaining({
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
        createdAt: expect.any(Date),
      }),
    );

    expect(persist).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    expect(result).toEqual(
      expect.objectContaining({
        eventType: 'WAGER_TRANSACTION_PROCESSED',
        status: 'PENDING',
      }),
    );
  });

  it('usa o EntityManager transacional fornecido', async () => {
    const transactionFlush = vi.fn().mockResolvedValue(undefined);
    const transactionCreate = vi.fn(
      (_entity: unknown, data: Record<string, unknown>) => data,
    );
    const transactionPersist = vi.fn(() => ({
      flush: transactionFlush,
    }));

    const tx = {
      create: transactionCreate,
      persist: transactionPersist,
    } as unknown as EntityManager;

    await service.enqueueTransaction(event, tx);

    expect(transactionCreate).toHaveBeenCalledWith(
      OutboxEvent,
      expect.objectContaining({
        aggregateId: event.walletId,
        status: 'PENDING',
      }),
    );

    expect(transactionPersist).toHaveBeenCalledOnce();
    expect(transactionFlush).toHaveBeenCalledOnce();

    // O gerenciador padrão não deve ser usado nesse caso.
    expect(create).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
