
import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
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
import { MetricsService } from '../observability/metrics.service.js';
import { InvalidMoneyError, Money } from '../domain/money.js';

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
    private readonly logger = new Logger(TransactionsService.name);
    constructor(
        private readonly em: EntityManager,
        private readonly ledgerService: LedgerService,
        private readonly outboxService: OutboxService,
        private readonly metrics: MetricsService,
    ) { }

    async processTransaction(
        input: CreateTransactionDto,
        idempotencyKey: string,
        manager: EntityManager = this.em,
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

        let inputMoney: Money;
        try { inputMoney = Money.from({ amount: input.amount, currency: input.currency }); }
        catch (error) {
            if (error instanceof InvalidMoneyError) throw new BadRequestException(error.message);
            throw error;
        }
        const amountCents = inputMoney.toMinorUnits();

        if (amountCents <= 0n) {
            throw new BadRequestException('O valor deve ser maior que zero');
        }

        const canonicalPayload = {
            currency: input.currency,
            externalReferenceTransactionId: input.externalReferenceTransactionId ?? null,
            externalTransactionId: input.externalTransactionId,
            gameId: input.gameId,
            playerId: input.playerId,
            providerId: input.providerId,
            roundId: input.roundId,
            type: input.type,
            amount: input.amount,
            walletId: input.walletId,
        };
        const payloadHash = createHash('sha256')
            .update(JSON.stringify(Object.fromEntries(Object.entries(canonicalPayload).sort(([a], [b]) => a.localeCompare(b)))))
            .digest('hex');

        const startedAt = performance.now();
        try {
            const result = await manager.transactional(
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

                        if (existing.status !== 'PENDING_REFERENCE') {
                            existing.idempotentReplay = true;
                            return existing;
                        }
                    }

                    const transaction = existing ?? tx.create(Transaction, {
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
                        retryAttempts: 0,
                        idempotentReplay: false,
                        createdAt: new Date(),
                    });

                    if (!existing) await tx.persist(transaction).flush();

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

                        await this.outboxService.enqueueTransaction({
                            transactionId: transaction.id, walletId: input.walletId,
                            playerId: input.playerId, type: input.type,
                            amount: input.amount, currency: input.currency,
                            status: 'REJECTED', failureCode: transaction.failureCode,
                        }, tx);

                        await tx.flush();
                        return transaction;
                    }

                    const balanceCents = toCents(wallet.balance);
                    transaction.responseBalance = wallet.balance;


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
                            transaction.retryAttempts += 1;
                            transaction.nextReferenceAttemptAt = new Date(Date.now() + Math.min(300, 2 ** transaction.retryAttempts) * 1000);
                            if (transaction.retryAttempts >= 10) {
                                transaction.status = 'REJECTED';
                                transaction.failureCode = 'REFERENCE_NOT_FOUND';
                                transaction.processedAt = new Date();
                                await this.outboxService.enqueueTransaction({
                                    transactionId: transaction.id, walletId: input.walletId,
                                    playerId: input.playerId, type: input.type, amount: input.amount,
                                    currency: input.currency, status: 'REJECTED', failureCode: transaction.failureCode,
                                }, tx);
                            } else {
                                await this.outboxService.enqueueTransaction({
                                    transactionId: transaction.id, walletId: input.walletId,
                                    playerId: input.playerId, type: input.type, amount: input.amount,
                                    currency: input.currency, status: 'PENDING_REFERENCE',
                                }, tx);
                            }
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
                            await this.enqueueRejected(transaction, input, tx);

                            await tx.flush();
                            return transaction;
                        }

                        if (toCents(original.amount) !== amountCents) {
                            transaction.status = 'REJECTED';
                            transaction.failureCode = 'AMOUNT_MISMATCH';
                            transaction.processedAt = new Date();
                            await this.enqueueRejected(transaction, input, tx);

                            await tx.flush();
                            return transaction;
                        }

                        const existingRollback = await tx.findOne(Transaction, {
                            id: { $ne: transaction.id },
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
                            await this.enqueueRejected(transaction, input, tx);

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
                            transaction.retryAttempts += 1;
                            transaction.nextReferenceAttemptAt = new Date(Date.now() + Math.min(300, 2 ** transaction.retryAttempts) * 1000);
                            if (transaction.retryAttempts >= 10) {
                                transaction.status = 'REJECTED';
                                transaction.failureCode = 'REFERENCE_NOT_FOUND';
                                transaction.processedAt = new Date();
                                await this.outboxService.enqueueTransaction({
                                    transactionId: transaction.id, walletId: input.walletId,
                                    playerId: input.playerId, type: input.type, amount: input.amount,
                                    currency: input.currency, status: 'REJECTED', failureCode: transaction.failureCode,
                                }, tx);
                            } else {
                                await this.outboxService.enqueueTransaction({
                                    transactionId: transaction.id, walletId: input.walletId,
                                    playerId: input.playerId, type: input.type, amount: input.amount,
                                    currency: input.currency, status: 'PENDING_REFERENCE',
                                }, tx);
                            }

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
                            await this.enqueueRejected(transaction, input, tx);

                            await tx.flush();
                            return transaction;
                        }

                        if (toCents(original.amount) !== amountCents) {
                            transaction.status = 'REJECTED';
                            transaction.failureCode = 'AMOUNT_MISMATCH';
                            transaction.processedAt = new Date();
                            await this.enqueueRejected(transaction, input, tx);

                            await tx.flush();
                            return transaction;
                        }

                        const existingRefund = await tx.findOne(Transaction, {
                            id: { $ne: transaction.id },
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
                            await this.enqueueRejected(transaction, input, tx);

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
                        transaction.failureCode = input.type === 'ROLLBACK'
                            ? 'ROLLBACK_WOULD_OVERDRAW' : 'INSUFFICIENT_FUNDS';
                        transaction.processedAt = new Date();

                        await this.outboxService.enqueueTransaction({
                            transactionId: transaction.id, walletId: input.walletId,
                            playerId: input.playerId, type: input.type,
                            amount: input.amount, currency: input.currency,
                            status: 'REJECTED', failureCode: transaction.failureCode,
                        }, tx);

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
                        await this.outboxService.enqueueTransaction({
                            transactionId: transaction.id, walletId: input.walletId,
                            playerId: input.playerId, type: input.type, amount: input.amount,
                            currency: input.currency, status: 'REJECTED', failureCode: transaction.failureCode,
                        }, tx);

                        await tx.flush();
                        return transaction;
                    }

                    wallet.balance = centsToMoney(newBalanceCents);
                    transaction.responseBalance = wallet.balance;
                    wallet.version += 1;
                    wallet.updatedAt = new Date();

                    transaction.status = 'PROCESSED';
                    transaction.processedAt = new Date();
                    transaction.nextReferenceAttemptAt = undefined;


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

                    await this.outboxService.enqueueBalanceChanged({
                        transactionId: transaction.id,
                        walletId: wallet.id,
                        direction: shouldDebit ? 'DEBIT' : 'CREDIT',
                        amount: input.amount,
                        currency: input.currency,
                        balanceBefore: centsToMoney(balanceCents),
                        balanceAfter: centsToMoney(newBalanceCents),
                        walletVersion: wallet.version,
                    }, tx);

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
            if (result.idempotentReplay) this.metrics.increment('wager_idempotent_duplicates_total');
            else this.metrics.increment('wager_transactions_total', `{status="${result.status}"}`);
            this.metrics.observe('wager_processing_duration_ms', performance.now() - startedAt);
            this.logger.log(JSON.stringify({
                event: 'wager_transaction_result', correlationId: result.id,
                transactionId: result.id, walletId: result.walletId,
                providerId: result.providerId, status: result.status,
                idempotentReplay: result.idempotentReplay,
            }));
            return result;
        } catch (error) {
            const databaseCode = typeof error === 'object' && error !== null && 'code' in error
                ? String((error as { code: unknown }).code) : '';
            if (databaseCode === '40P01' || databaseCode === '40001') {
                this.metrics.increment('wager_lock_conflicts_total');
            }
            // Trata colisões concorrentes de chaves ou identificadores únicos.
            if (!(error instanceof UniqueConstraintViolationException)) {
                throw error;
            }

            const existing = await manager.findOne(Transaction, {
                idempotencyKey,
            });

            if (existing) {
                if (existing.payloadHash !== payloadHash) {
                    throw new ConflictException(
                        'A chave de idempotência já foi usada com outro conteúdo',
                    );
                }

                existing.idempotentReplay = true;
                this.metrics.increment('wager_idempotent_duplicates_total');
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

    private enqueueRejected(
        transaction: Transaction,
        input: CreateTransactionDto,
        tx: EntityManager,
    ) {
        return this.outboxService.enqueueTransaction({
            transactionId: transaction.id, walletId: input.walletId,
            playerId: input.playerId, type: input.type,
            amount: input.amount, currency: input.currency,
            status: 'REJECTED', failureCode: transaction.failureCode,
        }, tx);
    }

    async findById(id: string): Promise<Transaction> {
        const transaction = await this.em.findOne(Transaction, { id });

        if (!transaction) {
            throw new NotFoundException('Transação não encontrada');
        }

        return transaction;
    }

    async findByProviderExternalId(providerId: string, externalTransactionId: string): Promise<Transaction> {
        const transaction = await this.em.findOne(Transaction, { providerId, externalTransactionId });
        if (!transaction) throw new NotFoundException('Transação não encontrada');
        return transaction;
    }

    async retryPendingReferences(): Promise<void> {
        // Workers não têm RequestContext HTTP; cada ciclo usa um identity map isolado.
        const workerEm = this.em.fork();
        const pending = await workerEm.find(Transaction, {
            status: 'PENDING_REFERENCE',
            nextReferenceAttemptAt: { $lte: new Date() },
        }, { limit: 20, orderBy: { nextReferenceAttemptAt: 'ASC' } });
        for (const item of pending) {
            await this.processTransaction({
                providerId: item.providerId,
                externalTransactionId: item.externalTransactionId,
                walletId: item.walletId,
                playerId: item.playerId,
                roundId: item.roundId,
                gameId: item.gameId,
                type: item.type as CreateTransactionDto['type'],
                amount: item.amount,
                currency: item.currency,
                externalReferenceTransactionId: item.referenceExternalTransactionId,
            }, item.idempotencyKey, workerEm);
        }
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
