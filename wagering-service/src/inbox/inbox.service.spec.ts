
import { describe, expect, it, vi } from 'vitest';
import { EntityManager } from '@mikro-orm/postgresql';

import { InboxEvent } from './inbox-event.entity.js';
import { InboxService } from './inbox.service.js';

function createMockEntityManager(existingEvent: unknown = null) {
  const flush = vi.fn().mockResolvedValue(undefined);

  const tx = {
    findOne: vi.fn().mockResolvedValue(existingEvent),
    create: vi.fn(
      (_entity: unknown, data: Record<string, unknown>) => data,
    ),
    persist: vi.fn((_entity: unknown) => ({ flush })),
  };

  const em = {
    transactional: vi.fn(
      async (
        callback: (manager: typeof tx) => Promise<unknown>,
      ) => callback(tx),
    ),
  } as unknown as EntityManager;

  return { em, tx, flush };
}

describe('InboxService', () => {
  it('registra uma mensagem nova', async () => {
    const { em, tx, flush } = createMockEntityManager();
    const service = new InboxService(em);

    const result = await service.recordMessage({
      transactionId: 'transaction-test-001',
      type: 'LOSS',
      amount: '5.00',
    });

    expect(result).toBe(true);
    expect(tx.findOne).toHaveBeenCalledWith(InboxEvent, {
      eventId: 'transaction-test-001',
    });
    expect(tx.create).toHaveBeenCalledWith(
      InboxEvent,
      expect.objectContaining({
        eventId: 'transaction-test-001',
        status: 'PROCESSED',
      }),
    );
    expect(tx.persist).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('não registra novamente um evento existente', async () => {
    const existingEvent = {
      eventId: 'transaction-test-001',
      status: 'PROCESSED',
    };

    const { em, tx, flush } =
      createMockEntityManager(existingEvent);

    const service = new InboxService(em);

    const result = await service.recordMessage({
      transactionId: 'transaction-test-001',
      type: 'LOSS',
      amount: '5.00',
    });

    expect(result).toBe(false);
    expect(tx.create).not.toHaveBeenCalled();
    expect(tx.persist).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });
});
