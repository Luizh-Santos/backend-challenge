
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager, QueryOrder, FilterQuery } from '@mikro-orm/core';
import { LedgerEntry } from './ledger-entry.entity.js';
import { Wallet } from '../wallets/wallet.entity.js';

interface CreateLedgerEntryInput {
  transactionId: string;
  walletId: string;
  type: 'CREDIT' | 'DEBIT';
  amount: string;
  currency: string;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);
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

  async reconcile(walletId: string) {
    const wallet = await this.em.findOne(Wallet, { id: walletId });
    if (!wallet) throw new NotFoundException('Carteira não encontrada');
    const cents = (value: string) => {
      const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
      if (!match) throw new Error('Valor decimal inválido na reconciliação');
      const magnitude = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
      return match[1] === '-' ? -magnitude : magnitude;
    };
    const [aggregate] = await this.em.getConnection().execute<Array<{ calculated: string; count: number }>>(
      `select coalesce(sum(case when type = 'CREDIT' then amount else -amount end), 0)::text as calculated, count(*)::int as count from ledger_entries where wallet_id = ?`,
      [walletId],
    );
    const total = cents(aggregate?.calculated ?? '0.00');
    const stored = cents(wallet.balance);
    const difference = stored - total;
    const format = (value: bigint) => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${((value < 0n ? -value : value) % 100n).toString().padStart(2, '0')}`;
    const consistent = difference === 0n;
    if (!consistent) this.logger.error(JSON.stringify({ event: 'wallet_reconciliation_mismatch', walletId, checkedEntries: aggregate?.count ?? 0 }));
    return {
      walletId,
      storedBalance: { amount: wallet.balance, currency: wallet.currency },
      calculatedBalance: { amount: format(total), currency: wallet.currency },
      difference: { amount: format(difference), currency: wallet.currency },
      consistent,
      checkedEntries: aggregate?.count ?? 0,
    };
  }
}
