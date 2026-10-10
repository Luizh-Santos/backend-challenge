
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
    LockMode,
    UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { createHash } from 'node:crypto';

import { Transaction } from './transaction.entity.js';
import { CreateTransactionDto } from './create-transaction.dto.js';
import { Wallet } from '../wallets/wallet.entity.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

function toCents(value: string): bigint {
    if (!/^(?:0|[1-9]\d{0,15})\.\d{2}$/.test(value)) {
        throw new BadRequestException('Valor monetário inválido');
    }

    const [whole, fraction] = value.split('.');

    return BigInt(whole!) * 100n + BigInt(fraction!);
}

function centsToMoney(value: bigint): string {
    const whole = value / 100n;
    const fraction = (value % 100n).toString().padStart(2, '0');

    return `${whole}.${fraction}`;
}

@Injectable()
export class TransactionsService {
    constructor(
        private readonly em: EntityManager,
        private readonly ledgerService: LedgerService,
        private readonly outboxService: OutboxService,
    ) { }

    async processTransaction(
        input: CreateTransactionDto,
        idempotencyKey: string,
    ): Promise<Transaction> {
        if (
            !['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'].includes(input.type)
        ) {
            throw new BadRequestException('Tipo de transação inválido');
        }

        if (
            (input.type === 'REFUND' || input.type === 'ROLLBACK') &&
            !input.externalReferenceTransactionId?.trim()
        ) {
            throw new BadRequestException(
                'Esta transação exige o identificador da transação de referência',
            );
        }

        const amountCents = toCents(input.amount);

        if (amountCents <= 0n) {
            throw new BadRequestException('O valor deve ser maior que zero');
        }

        const payloadHash = createHash('sha256')
            .update(
                JSON.stringify([
                    input.providerId,
                    input.externalTransactionId,
                    input.walletId,
                    input.playerId,
                    input.roundId,
                    input.gameId,
                    input.type,
                    input.amount,
                    input.currency,
                    input.externalReferenceTransactionId ?? null,
                ]),
            )
            .digest('hex');

        try {
            return await this.em.transactional(
                async (tx): Promise<Transaction> => {
                    // Repetir a mesma chave com o mesmo conteúdo devolve a transação.
                    const existing = await tx.findOne(Transaction, {
                        idempotencyKey,
                    });

                    if (existing) {
                        if (existing.payloadHash !== payloadHash) {
                            throw new ConflictException(
                                'A chave de idempotência já foi usada com outro conteúdo',
                            );
                        }

                        return existing;
                    }

                    const transaction = tx.create(Transaction, {
                        providerId: input.providerId,
                        externalTransactionId: input.externalTransactionId,
                        idempotencyKey,
                        payloadHash,
                        walletId: input.walletId,
                        playerId: input.playerId,
                        roundId: input.roundId,
                        gameId: input.gameId,
                        type: input.type,
                        amount: input.amount,
                        currency: input.currency,
                        referenceExternalTransactionId:
                            input.externalReferenceTransactionId,
                        status: 'PENDING',
                        createdAt: new Date(),
                    });

                    await tx.persist(transaction).flush();

                    // Serializa movimentações concorrentes da mesma carteira.
                    const wallet = await tx.findOne(
                        Wallet,
                        { id: input.walletId },
                        { lockMode: LockMode.PESSIMISTIC_WRITE },
                    );

                    if (!wallet) {
                        throw new NotFoundException('Carteira não encontrada');
                    }

                    if (
                        wallet.playerId !== input.playerId ||
                        wallet.currency !== input.currency
                    ) {
                        transaction.status = 'REJECTED';
                        transaction.failureCode = 'WALLET_MISMATCH';
                        transaction.processedAt = new Date();

                        await tx.flush();
                        return transaction;
                    }

                    const balanceCents = toCents(wallet.balance);


                    if (input.type === 'LOSS') {
                        transaction.status = 'PROCESSED';
                        transaction.processedAt = new Date();

                        await this.outboxService.enqueueTransaction(
                            {
                                transactionId: transaction.id,
                                walletId: wallet.id,
                                playerId: transaction.playerId,
                                type: transaction.type,
                                amount: transaction.amount,
                                currency: transaction.currency,
                                status: transaction.status,
                            },
                            tx,
                        );

                        await tx.flush();
                        return transaction;
                    }


                    // Não creditar ROLLBACK até implementar sua validação específica.

                    let rollbackOriginal: Transaction | null = null;

                    if (input.type === 'ROLLBACK') {
                        const original = await tx.findOne(
                            Transaction,
                            {
                                providerId: input.providerId,
                                externalTransactionId:
                                    input.externalReferenceTransactionId!,
                            },
                            { lockMode: LockMode.PESSIMISTIC_WRITE },
                        );

                        if (!original) {
                            transaction.status = 'PENDING_REFERENCE';
                            await tx.flush();
                            return transaction;
                        }

                        const sameContext =
                            original.playerId === input.playerId &&
                            original.walletId === input.walletId &&
                            original.currency === input.currency &&
                            original.roundId === input.roundId;

                        if (
                            !['BET', 'WIN', 'REFUND'].includes(original.type) ||
                            original.status !== 'PROCESSED' ||
                            !sameContext
                        ) {
                            transaction.status = 'REJECTED';
                            transaction.failureCode = 'INVALID_REFERENCE';
                            transaction.processedAt = new Date();

                            await tx.flush();
                            return transaction;
                        }

                        if (toCents(original.amount) !== amountCents) {
                            transaction.status = 'REJECTED';
                            transaction.failureCode = 'AMOUNT_MISMATCH';
                            transaction.processedAt = new Date();

                            await tx.flush();
                            return transaction;
                        }

                        const existingRollback = await tx.findOne(Transaction, {
                            providerId: input.providerId,
                            referenceExternalTransactionId:
                                original.externalTransactionId,
                            type: 'ROLLBACK',
                            status: 'PROCESSED',
                        });

                        if (existingRollback) {
                            transaction.status = 'REJECTED';
                            transaction.failureCode = 'REFERENCE_ALREADY_REVERSED';
                            transaction.processedAt = new Date();

                            await tx.flush();
                            return transaction;
                        }

                        rollbackOriginal = original;
                    }


                    // REFUND deve referenciar uma aposta processada válida.
                    if (input.type === 'REFUND') {
                        const original = await tx.findOne(
                            Transaction,
                            {
                                providerId: input.providerId,
                                externalTransactionId:
                                    input.externalReferenceTransactionId!,
                            },
                            { lockMode: LockMode.PESSIMISTIC_WRITE },
                        );

                        if (!original) {
                            transaction.status = 'PENDING_REFERENCE';

                            await tx.flush();
                            return transaction;
                        }

                        const sameContext =
                            original.playerId === input.playerId &&
                            original.walletId === input.walletId &&
                            original.currency === input.currency &&
                            original.roundId === input.roundId;

                        if (
                            original.type !== 'BET' ||
                            original.status !== 'PROCESSED' ||
                            !sameContext
                        ) {
                            transaction.status = 'REJECTED';
                            transaction.failureCode = 'INVALID_REFERENCE';
                            transaction.processedAt = new Date();

                            await tx.flush();
                            return transaction;
                        }

                        if (toCents(original.amount) !== amountCents) {
                            transaction.status = 'REJECTED';
                            transaction.failureCode = 'AMOUNT_MISMATCH';
                            transaction.processedAt = new Date();

                            await tx.flush();
                            return transaction;
                        }

                        const existingRefund = await tx.findOne(Transaction, {
                            providerId: input.providerId,
                            referenceExternalTransactionId:
                                original.externalTransactionId,
                            type: 'REFUND',
                            status: 'PROCESSED',
                        });

                        if (existingRefund) {
                            transaction.status = 'REJECTED';
                            transaction.failureCode = 'REFERENCE_ALREADY_REFUNDED';
                            transaction.processedAt = new Date();

                            await tx.flush();
                            return transaction;
                        }
                    }


                    const shouldDebit =
                        input.type === 'BET' ||
                        (
                            input.type === 'ROLLBACK' &&
                            (
                                rollbackOriginal?.type === 'WIN' ||
                                rollbackOriginal?.type === 'REFUND'
                            )
                        );

                    // BET e reversões de WIN/REFUND precisam de saldo suficiente.
                    if (shouldDebit && balanceCents < amountCents) {
                        transaction.status = 'REJECTED';
                        transaction.failureCode = 'INSUFFICIENT_FUNDS';
                        transaction.processedAt = new Date();

                        await tx.flush();
                        return transaction;
                    }

                    // BET debita; ROLLBACK de BET credita.
                    // WIN e REFUND creditam; ROLLBACK deles debita.
                    const newBalanceCents = shouldDebit
                        ? balanceCents - amountCents
                        : balanceCents + amountCents;


                    if (newBalanceCents > 999999999999999999n) {
                        transaction.status = 'REJECTED';
                        transaction.failureCode = 'BALANCE_LIMIT_EXCEEDED';
                        transaction.processedAt = new Date();

                        await tx.flush();
                        return transaction;
                    }

                    wallet.balance = centsToMoney(newBalanceCents);
                    wallet.version += 1;
                    wallet.updatedAt = new Date();

                    transaction.status = 'PROCESSED';
                    transaction.processedAt = new Date();


                    await this.ledgerService.createEntry(
                        {
                            transactionId: transaction.id,
                            walletId: wallet.id,
                            type: shouldDebit ? 'DEBIT' : 'CREDIT',
                            amount: input.amount,
                            currency: input.currency,
                        },
                        tx,
                    );

                    await this.outboxService.enqueueTransaction(
                        {
                            transactionId: transaction.id,
                            walletId: wallet.id,
                            playerId: transaction.playerId,
                            type: transaction.type,
                            amount: transaction.amount,
                            currency: transaction.currency,
                            status: transaction.status,
                        },
                        tx,
                    );

                    await tx.flush();

                    return transaction;

                },
            );
        } catch (error) {
            // Trata colisões concorrentes de chaves ou identificadores únicos.
            if (!(error instanceof UniqueConstraintViolationException)) {
                throw error;
            }

            const existing = await this.em.findOne(Transaction, {
                idempotencyKey,
            });

            if (existing) {
                if (existing.payloadHash !== payloadHash) {
                    throw new ConflictException(
                        'A chave de idempotência já foi usada com outro conteúdo',
                    );
                }

                return existing;
            }

            throw new ConflictException(
                'Já existe uma transação com esse provedor e identificador externo',
            );
        }
    }

    async findByIdempotencyKey(
        idempotencyKey: string,
    ): Promise<Transaction | null> {
        const transaction = await this.em.findOne(Transaction, {
            idempotencyKey,
        });

        return transaction ?? null;
    }

    async findById(id: string): Promise<Transaction> {
        const transaction = await this.em.findOne(Transaction, { id });

        if (!transaction) {
            throw new NotFoundException('Transação não encontrada');
        }

        return transaction;
    }

    async ensureIdempotencyKeyAvailable(
        idempotencyKey: string,
        payloadHash: string,
    ): Promise<Transaction | null> {
        const existing = await this.findByIdempotencyKey(idempotencyKey);

        if (!existing) {
            return null;
        }

        if (existing.payloadHash !== payloadHash) {
            throw new ConflictException(
                'A chave de idempotência já foi usada com outro conteúdo',
            );
        }

        return existing;
    }
}
