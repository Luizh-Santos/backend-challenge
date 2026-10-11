
import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, UniqueConstraintViolationException } from '@mikro-orm/postgresql';
import { createHash } from 'node:crypto';

import { Wallet } from './wallet.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { LedgerService } from '../ledger/ledger.service.js';

@Injectable()
export class WalletsService {
  constructor(
    private readonly em: EntityManager,
    private readonly ledgerService: LedgerService,
  ) {}

  async create(
    playerId: string,
    initialBalance: string,
    currency = 'BRL',
  ): Promise<Wallet> {
    if (!playerId.trim()) {
      throw new BadRequestException('playerId é obrigatório');
    }

    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('Moeda inválida');
    }

    if (!/^(?:0|[1-9]\d{0,15})\.\d{2}$/.test(initialBalance)) {
      throw new BadRequestException(
        'initialBalance deve ser um valor decimal com duas casas, como 100.00',
      );
    }

    try {
      return await this.em.transactional(async (tx) => {
        const existing = await tx.findOne(Wallet, {
          playerId: playerId.trim(),
          currency,
        });

        if (existing) {
          throw new ConflictException(
            'Já existe uma carteira para este jogador e esta moeda',
          );
        }

        const now = new Date();
        const wallet = new Wallet();

        wallet.playerId = playerId.trim();
        wallet.currency = currency;
        wallet.balance = initialBalance;
        wallet.version = 1;
        wallet.createdAt = now;
        wallet.updatedAt = now;

        await tx.persist(wallet).flush();

        if (initialBalance !== '0.00') {
          const openingId = `wallet-opening:${wallet.id}`;
          const payloadHash = createHash('sha256')
            .update(JSON.stringify([
              wallet.id,
              wallet.playerId,
              wallet.currency,
              initialBalance,
            ]))
            .digest('hex');

          const opening = tx.create(Transaction, {
            providerId: 'INTERNAL',
            externalTransactionId: openingId,
            idempotencyKey: openingId,
            payloadHash,
            walletId: wallet.id,
            playerId: wallet.playerId,
            roundId: 'INTERNAL',
            gameId: 'INTERNAL',
            type: 'OPENING',
            amount: initialBalance,
            currency,
            status: 'PROCESSED',
            retryAttempts: 0,
            idempotentReplay: false,
            processedAt: now,
            createdAt: now,
          });

          await tx.persist(opening).flush();
          await this.ledgerService.createEntry(
            {
              transactionId: opening.id,
              walletId: wallet.id,
              type: 'CREDIT',
              amount: initialBalance,
              currency,
            },
            tx,
          );
        }

        return wallet;
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException(
          'Já existe uma carteira ou lançamento com este identificador',
        );
      }

      throw error;
    }
  }

  async findById(walletId: string): Promise<Wallet> {
  const wallet = await this.em.findOne(Wallet, {
    id: walletId,
  });

  if (!wallet) {
    throw new NotFoundException('Carteira não encontrada');
  }

  return wallet;
}
}
