
import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager, QueryOrder, FilterQuery } from '@mikro-orm/core';
import { LedgerEntry } from './ledger-entry.entity.js';

interface CreateLedgerEntryInput {
  transactionId: string;
  walletId: string;
  type: 'CREDIT' | 'DEBIT';
  amount: string;
  currency: string;
}

@Injectable()
export class LedgerService {
  constructor(private readonly em: EntityManager) {}

  async createEntry(
    input: CreateLedgerEntryInput,
    em: EntityManager = this.em,
  ): Promise<LedgerEntry> {
    const entry = em.create(LedgerEntry, {
      transactionId: input.transactionId,
      walletId: input.walletId,
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      createdAt: new Date(),
    });

    await em.persist(entry).flush();

    return entry;
  }

  async findByWallet(
    walletId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ items: LedgerEntry[]; nextCursor: string | null }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException(
        'O limite deve ser um número entre 1 e 100',
      );
    }

    let where: FilterQuery<LedgerEntry> = { walletId };

    if (cursor) {
      let decoded: string;

      try {
        decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      } catch {
        throw new BadRequestException('Cursor inválido');
      }

      const separator = decoded.lastIndexOf('|');
      const dateText = decoded.slice(0, separator);
      const id = decoded.slice(separator + 1);
      const date = new Date(dateText);

      if (
        separator < 1 ||
        Number.isNaN(date.getTime()) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ) {
        throw new BadRequestException('Cursor inválido');
      }

      where = {
        walletId,
        $or: [
          { createdAt: { $lt: date } },
          { createdAt: date, id: { $lt: id } },
        ],
      };
    }

    const results = await this.em.find(LedgerEntry, where, {
      orderBy: {
        createdAt: QueryOrder.DESC,
        id: QueryOrder.DESC,
      },
      limit: limit + 1,
    });

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    const lastItem = items[items.length - 1];

    const nextCursor =
      hasMore && lastItem
        ? Buffer.from(
            `${lastItem.createdAt.toISOString()}|${lastItem.id}`,
          ).toString('base64url')
        : null;

    return { items, nextCursor };
  }
}
