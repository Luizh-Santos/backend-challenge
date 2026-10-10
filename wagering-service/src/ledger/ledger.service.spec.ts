
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityManager } from '@mikro-orm/core';

import { LedgerEntry } from './ledger-entry.entity.js';
import { LedgerService } from './ledger.service.js';

describe('LedgerService', () => {
  let service: LedgerService;
  let em: EntityManager;
  let find: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let persist: ReturnType<typeof vi.fn>;
  let flush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    find = vi.fn();
    flush = vi.fn().mockResolvedValue(undefined);
    create = vi.fn(
      (_entity: unknown, data: Record<string, unknown>) => data,
    );
    persist = vi.fn(() => ({ flush }));

    em = {
      find,
      create,
      persist,
    } as unknown as EntityManager;

    service = new LedgerService(em);
  });

  it('cria um lançamento de crédito no ledger', async () => {
    const input = {
      transactionId: '11111111-1111-4111-8111-111111111111',
      walletId: '22222222-2222-4222-8222-222222222222',
      type: 'CREDIT' as const,
      amount: '100.00',
      currency: 'BRL',
    };

    const result = await service.createEntry(input);

    expect(create).toHaveBeenCalledWith(
      LedgerEntry,
      expect.objectContaining({
        transactionId: input.transactionId,
        walletId: input.walletId,
        type: 'CREDIT',
        amount: '100.00',
        currency: 'BRL',
        createdAt: expect.any(Date),
      }),
    );

    expect(persist).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    expect(result).toEqual(
      expect.objectContaining({
        transactionId: input.transactionId,
        amount: '100.00',
      }),
    );
  });

  it('retorna uma página sem cursor quando não há mais registros', async () => {
    const entry = {
      id: '33333333-3333-4333-8333-333333333333',
      walletId: '22222222-2222-4222-8222-222222222222',
      type: 'DEBIT',
      amount: '30.00',
      currency: 'BRL',
      createdAt: new Date('2026-10-10T12:00:00.000Z'),
    } as LedgerEntry;

    find.mockResolvedValue([entry]);

    const result = await service.findByWallet(entry.walletId, undefined, 2);

    expect(result.items).toEqual([entry]);
    expect(result.nextCursor).toBeNull();
    expect(find).toHaveBeenCalledOnce();
  });

  it('gera um cursor quando existem mais registros que o limite', async () => {
    const first = {
      id: '33333333-3333-4333-8333-333333333333',
      walletId: '22222222-2222-4222-8222-222222222222',
      createdAt: new Date('2026-10-10T12:00:00.000Z'),
    } as LedgerEntry;

    const second = {
      id: '44444444-4444-4444-8444-444444444444',
      walletId: first.walletId,
      createdAt: new Date('2026-10-10T11:00:00.000Z'),
    } as LedgerEntry;

    find.mockResolvedValue([first, second]);

    const result = await service.findByWallet(first.walletId, undefined, 1);

    expect(result.items).toEqual([first]);
    expect(result.nextCursor).toBe(
      Buffer.from(
        `${first.createdAt.toISOString()}|${first.id}`,
      ).toString('base64url'),
    );

    expect(find).toHaveBeenCalledWith(
      LedgerEntry,
      { walletId: first.walletId },
      expect.objectContaining({ limit: 2 }),
    );
  });

  it('usa o cursor para buscar a página seguinte', async () => {
    const walletId = '22222222-2222-4222-8222-222222222222';
    const previousDate = new Date('2026-10-10T12:00:00.000Z');
    const previousId = '33333333-3333-4333-8333-333333333333';

    const cursor = Buffer.from(
      `${previousDate.toISOString()}|${previousId}`,
    ).toString('base64url');

    const nextEntry = {
      id: '44444444-4444-4444-8444-444444444444',
      walletId,
      createdAt: new Date('2026-10-10T11:00:00.000Z'),
    } as LedgerEntry;

    find.mockResolvedValue([nextEntry]);

    const result = await service.findByWallet(walletId, cursor, 1);

    expect(result.items).toEqual([nextEntry]);
    expect(result.nextCursor).toBeNull();

    const where = find.mock.calls[0][1] as {
      walletId: string;
      $or: Array<Record<string, unknown>>;
    };

    expect(where.walletId).toBe(walletId);
    expect(where.$or).toHaveLength(2);
  });

  it.each([0, -1, 101, 1.5, Number.NaN])(
    'rejeita limite inválido: %s',
    async (limit) => {
      await expect(
        service.findByWallet('wallet-id', undefined, limit),
      ).rejects.toThrow(
        'O limite deve ser um número entre 1 e 100',
      );

      expect(find).not.toHaveBeenCalled();
    },
  );

  it('rejeita um cursor inválido', async () => {
    await expect(
      service.findByWallet('wallet-id', 'cursor-invalido', 10),
    ).rejects.toThrow('Cursor inválido');

    expect(find).not.toHaveBeenCalled();
  });
});
