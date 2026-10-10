
import { describe, expect, it, vi } from 'vitest';
import { EntityManager } from '@mikro-orm/postgresql';

import { OutboxPublisherService } from './outbox-publisher.service.js';
import { SqsService } from '../sqs/sqs.service.js';

type ClaimedOutboxRow = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
};

function createHarness(rows: ClaimedOutboxRow[]) {
  const claimConnection = {
    execute: vi.fn().mockResolvedValue(rows),
  };

  const updateConnection = {
    execute: vi.fn().mockResolvedValue(undefined),
  };

  const tx = {
    getConnection: () => claimConnection,
  };

  const db = {
    transactional: vi.fn(
      async (callback: (manager: typeof tx) => Promise<unknown>) =>
        callback(tx),
    ),
    getConnection: () => updateConnection,
  };

  const em = {
    fork: vi.fn(() => db),
  } as unknown as EntityManager;

  const sqs = {
    publishTransaction: vi.fn().mockResolvedValue(undefined),
  } as unknown as SqsService;

  const service = new OutboxPublisherService(em, sqs);

  return {
    service,
    sqs,
    claimConnection,
    updateConnection,
  };
}

const event: ClaimedOutboxRow = {
  id: '11111111-1111-4111-8111-111111111111',
  event_type: 'WAGER_TRANSACTION_PROCESSED',
  aggregate_id: '22222222-2222-4222-8222-222222222222',
  payload: {
    transactionId: '33333333-3333-4333-8333-333333333333',
    type: 'LOSS',
    status: 'PROCESSED',
  },
  attempts: 1,
};

async function publishBatch(
  service: OutboxPublisherService,
): Promise<void> {
  await (
    service as unknown as {
      publishBatch: () => Promise<void>;
    }
  ).publishBatch();
}

describe('OutboxPublisherService', () => {
  it('publica o evento e marca a Outbox como PUBLISHED', async () => {
    const {
      service,
      sqs,
      updateConnection,
    } = createHarness([event]);

    await publishBatch(service);

    expect(sqs.publishTransaction).toHaveBeenCalledWith(
      event.payload,
      event.aggregate_id,
      event.id,
    );

    expect(updateConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'PUBLISHED'"),
      [event.id],
    );
  });

  it('mantém o evento pendente e agenda nova tentativa quando o SQS falha', async () => {
    const {
      service,
      sqs,
      updateConnection,
    } = createHarness([event]);

    vi.mocked(sqs.publishTransaction).mockRejectedValueOnce(
      new Error('SQS indisponível'),
    );

    await publishBatch(service);

    expect(updateConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'PENDING'"),
      [2, 'SQS indisponível', event.id],
    );
  });

  it('não publica nem atualiza nada quando não existem eventos pendentes', async () => {
    const {
      service,
      sqs,
      updateConnection,
    } = createHarness([]);

    await publishBatch(service);

    expect(sqs.publishTransaction).not.toHaveBeenCalled();
    expect(updateConnection.execute).not.toHaveBeenCalled();
  });
});
