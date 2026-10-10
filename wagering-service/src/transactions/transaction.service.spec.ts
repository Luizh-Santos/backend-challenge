import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityManager } from '@mikro-orm/postgresql';

import { TransactionsService } from './transaction.service.js';
import { CreateTransactionDto } from './create-transaction.dto.js';
import { Transaction } from './transaction.entity.js';
import { Wallet } from '../wallets/wallet.entity.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

describe('TransactionsService', () => {
    let service: TransactionsService;
    let wallet: Wallet;
    let em: EntityManager;
    let ledgerService: LedgerService;
    let outboxService: OutboxService;
    let tx: {
        findOne: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        persist: ReturnType<typeof vi.fn>;
        flush: ReturnType<typeof vi.fn>;

    };

    it('retorna a transação original quando a chave e o conteúdo são iguais', async () => {
        const key = 'idem-replay-test-001';

        const existing = Object.assign(new Transaction(), {
            id: '32651314-bbac-4cc3-b841-13a8c29d2910',
            idempotencyKey: key,
            payloadHash: hashInput(input),
            status: 'PROCESSED',
            amount: input.amount,
            type: input.type,
        });

        tx.findOne.mockImplementation(async (entity: unknown) => {
            if (entity === Transaction) return existing;
            if (entity === Wallet) return wallet;
            return null;
        });

        const result = await service.processTransaction(input, key);

        expect(result).toBe(existing);
        expect(wallet.balance).toBe('100.00');
        expect(ledgerService.createEntry).not.toHaveBeenCalled();
        expect(outboxService.enqueueTransaction).not.toHaveBeenCalled();
    });

    it('rejeita a reutilização da chave com conteúdo diferente', async () => {
        const key = 'idem-conflict-test-001';

        const existing = Object.assign(new Transaction(), {
            id: '32651314-bbac-4cc3-b841-13a8c29d2910',
            idempotencyKey: key,
            payloadHash: 'hash-diferente',
            status: 'PROCESSED',
            amount: input.amount,
            type: input.type,
        });

        tx.findOne.mockImplementation(async (entity: unknown) => {
            if (entity === Transaction) return existing;
            if (entity === Wallet) return wallet;
            return null;
        });

        await expect(
            service.processTransaction(input, key),
        ).rejects.toThrow(
            'A chave de idempotência já foi usada com outro conteúdo',
        );

        expect(wallet.balance).toBe('100.00');
        expect(ledgerService.createEntry).not.toHaveBeenCalled();
        expect(outboxService.enqueueTransaction).not.toHaveBeenCalled();
    });

    it('credita a carteira e registra ledger e outbox para WIN', async () => {
        const winInput: CreateTransactionDto = {
            ...input,
            externalTransactionId: 'win-test-001',
            type: 'WIN',
            amount: '15.00',
        };

        const result = await service.processTransaction(
            winInput,
            'idem-win-test-001',
        );

        expect(result.status).toBe('PROCESSED');
        expect(wallet.balance).toBe('115.00');
        expect(wallet.version).toBe(2);

        expect(ledgerService.createEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'CREDIT',
                amount: '15.00',
                currency: 'BRL',
            }),
            tx,
        );

        expect(outboxService.enqueueTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'WIN',
                status: 'PROCESSED',
            }),
            tx,
        );
    });

    it('registra LOSS na outbox sem alterar saldo ou criar lançamento', async () => {
        const lossInput: CreateTransactionDto = {
            ...input,
            externalTransactionId: 'loss-test-002',
            type: 'LOSS',
            amount: '5.00',
        };

        const result = await service.processTransaction(
            lossInput,
            'idem-loss-test-002',
        );

        expect(result.status).toBe('PROCESSED');
        expect(wallet.balance).toBe('100.00');
        expect(wallet.version).toBe(1);

        expect(ledgerService.createEntry).not.toHaveBeenCalled();

        expect(outboxService.enqueueTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'LOSS',
                status: 'PROCESSED',
            }),
            tx,
        );
    });


    it('processa REFUND válido e credita a carteira', async () => {
        const original = Object.assign(new Transaction(), {
            id: '11111111-1111-4111-8111-111111111111',
            providerId: 'provider-test',
            externalTransactionId: 'original-bet-refund-test',
            walletId: input.walletId,
            playerId: input.playerId,
            roundId: input.roundId,
            gameId: input.gameId,
            type: 'BET',
            amount: '30.00',
            currency: 'BRL',
            status: 'PROCESSED',
        });

        tx.findOne.mockImplementation(
            async (entity: unknown, where?: Record<string, unknown>) => {
                if (entity === Wallet) return wallet;

                if (entity === Transaction) {
                    if (where?.idempotencyKey) return null;

                    if (
                        where?.externalTransactionId ===
                        'original-bet-refund-test'
                    ) {
                        return original;
                    }

                    return null;
                }

                return null;
            },
        );

        const refundInput: CreateTransactionDto = {
            ...input,
            externalTransactionId: 'refund-test-001',
            externalReferenceTransactionId: 'original-bet-refund-test',
            type: 'REFUND',
            amount: '30.00',
        };

        const result = await service.processTransaction(
            refundInput,
            'idem-refund-test-001',
        );

        expect(result.status).toBe('PROCESSED');
        expect(wallet.balance).toBe('130.00');
        expect(wallet.version).toBe(2);

        expect(ledgerService.createEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'CREDIT',
                amount: '30.00',
            }),
            tx,
        );
    });

    it('processa ROLLBACK de BET e credita a carteira', async () => {
        const original = Object.assign(new Transaction(), {
            id: '22222222-2222-4222-8222-222222222222',
            providerId: 'provider-test',
            externalTransactionId: 'original-bet-rollback-test',
            walletId: input.walletId,
            playerId: input.playerId,
            roundId: input.roundId,
            gameId: input.gameId,
            type: 'BET',
            amount: '30.00',
            currency: 'BRL',
            status: 'PROCESSED',
        });

        tx.findOne.mockImplementation(
            async (entity: unknown, where?: Record<string, unknown>) => {
                if (entity === Wallet) return wallet;

                if (entity === Transaction) {
                    if (where?.idempotencyKey) return null;

                    if (
                        where?.externalTransactionId ===
                        'original-bet-rollback-test'
                    ) {
                        return original;
                    }

                    return null;
                }

                return null;
            },
        );

        const rollbackInput: CreateTransactionDto = {
            ...input,
            externalTransactionId: 'rollback-test-001',
            externalReferenceTransactionId: 'original-bet-rollback-test',
            type: 'ROLLBACK',
            amount: '30.00',
        };

        const result = await service.processTransaction(
            rollbackInput,
            'idem-rollback-test-001',
        );

        expect(result.status).toBe('PROCESSED');
        expect(wallet.balance).toBe('130.00');
        expect(wallet.version).toBe(2);

        expect(ledgerService.createEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'CREDIT',
                amount: '30.00',
            }),
            tx,
        );
    });


    it('rejeita REFUND quando a aposta original pertence a outro contexto', async () => {
        const original = Object.assign(new Transaction(), {
            id: '33333333-3333-4333-8333-333333333333',
            providerId: 'provider-test',
            externalTransactionId: 'original-bet-invalid-ref',
            walletId: input.walletId,
            playerId: 'outro-jogador',
            roundId: input.roundId,
            gameId: input.gameId,
            type: 'BET',
            amount: '30.00',
            currency: 'BRL',
            status: 'PROCESSED',
        });

        tx.findOne.mockImplementation(
            async (entity: unknown, where?: Record<string, unknown>) => {
                if (entity === Wallet) return wallet;

                if (entity === Transaction) {
                    if (where?.idempotencyKey) return null;

                    if (
                        where?.externalTransactionId ===
                        'original-bet-invalid-ref'
                    ) {
                        return original;
                    }

                    return null;
                }

                return null;
            },
        );

        const refundInput: CreateTransactionDto = {
            ...input,
            externalTransactionId: 'refund-invalid-ref-001',
            externalReferenceTransactionId: 'original-bet-invalid-ref',
            type: 'REFUND',
            amount: '30.00',
        };

        const result = await service.processTransaction(
            refundInput,
            'idem-refund-invalid-ref-001',
        );

        expect(result.status).toBe('REJECTED');
        expect(result.failureCode).toBe('INVALID_REFERENCE');
        expect(wallet.balance).toBe('100.00');
        expect(wallet.version).toBe(1);
        expect(ledgerService.createEntry).not.toHaveBeenCalled();
        expect(outboxService.enqueueTransaction).not.toHaveBeenCalled();
    });

    it('rejeita um valor monetário inválido', async () => {
        const invalidInput: CreateTransactionDto = {
            ...input,
            amount: 'valor-invalido',
        };

        await expect(
            service.processTransaction(invalidInput, 'idem-invalid-amount'),
        ).rejects.toThrow('Valor monetário inválido');

        expect(em.transactional).not.toHaveBeenCalled();
        expect(ledgerService.createEntry).not.toHaveBeenCalled();
    });

    it('rejeita um valor igual a zero', async () => {
        const zeroInput: CreateTransactionDto = {
            ...input,
            amount: '0.00',
        };

        await expect(
            service.processTransaction(zeroInput, 'idem-zero-amount'),
        ).rejects.toThrow('O valor deve ser maior que zero');

        expect(em.transactional).not.toHaveBeenCalled();
        expect(ledgerService.createEntry).not.toHaveBeenCalled();
    });

    it.each(['REFUND', 'ROLLBACK'] as const)(
        'exige uma transação de referência para %s',
        async (type) => {
            const invalidInput: CreateTransactionDto = {
                ...input,
                type,
                externalReferenceTransactionId: undefined,
            };

            await expect(
                service.processTransaction(
                    invalidInput,
                    `idem-missing-reference-${type}`,
                ),
            ).rejects.toThrow(
                'Esta transação exige o identificador da transação de referência',
            );

            expect(em.transactional).not.toHaveBeenCalled();
            expect(ledgerService.createEntry).not.toHaveBeenCalled();
        },
    );

    it('rejeita REFUND com valor diferente da aposta original', async () => {
        const original = Object.assign(new Transaction(), {
            id: '11111111-1111-4111-8111-111111111111',
            providerId: input.providerId,
            externalTransactionId: 'refund-amount-original',
            walletId: input.walletId,
            playerId: input.playerId,
            roundId: input.roundId,
            gameId: input.gameId,
            type: 'BET',
            amount: '30.00',
            currency: 'BRL',
            status: 'PROCESSED',
        });

        tx.findOne.mockImplementation(
            async (entity: unknown, where?: Record<string, unknown>) => {
                if (entity === Wallet) return wallet;

                if (entity === Transaction) {
                    if (where?.idempotencyKey) return null;

                    if (
                        where?.externalTransactionId ===
                        'refund-amount-original'
                    ) {
                        return original;
                    }

                    return null;
                }

                return null;
            },
        );

        const refundInput: CreateTransactionDto = {
            ...input,
            externalTransactionId: 'refund-wrong-amount',
            externalReferenceTransactionId: 'refund-amount-original',
            type: 'REFUND',
            amount: '29.00',
        };

        const result = await service.processTransaction(
            refundInput,
            'idem-refund-wrong-amount',
        );

        expect(result.status).toBe('REJECTED');
        expect(result.failureCode).toBe('AMOUNT_MISMATCH');
        expect(wallet.balance).toBe('100.00');
        expect(wallet.version).toBe(1);
        expect(ledgerService.createEntry).not.toHaveBeenCalled();
        expect(outboxService.enqueueTransaction).not.toHaveBeenCalled();
    });

    it('mantém REFUND pendente quando a referência ainda não existe', async () => {
        const refundInput: CreateTransactionDto = {
            ...input,
            externalTransactionId: 'refund-pending-reference',
            externalReferenceTransactionId: 'bet-not-arrived-yet',
            type: 'REFUND',
            amount: '30.00',
        };

        const result = await service.processTransaction(
            refundInput,
            'idem-refund-pending-reference',
        );

        expect(result.status).toBe('PENDING_REFERENCE');
        expect(wallet.balance).toBe('100.00');
        expect(wallet.version).toBe(1);
        expect(ledgerService.createEntry).not.toHaveBeenCalled();
        expect(outboxService.enqueueTransaction).not.toHaveBeenCalled();
    });

    it('rejeita ROLLBACK quando a aposta já foi revertida', async () => {
        const original = Object.assign(new Transaction(), {
            id: '22222222-2222-4222-8222-222222222222',
            providerId: input.providerId,
            externalTransactionId: 'rollback-already-reversed',
            walletId: input.walletId,
            playerId: input.playerId,
            roundId: input.roundId,
            gameId: input.gameId,
            type: 'BET',
            amount: '30.00',
            currency: 'BRL',
            status: 'PROCESSED',
        });

        const previousRollback = Object.assign(new Transaction(), {
            id: '33333333-3333-4333-8333-333333333333',
            providerId: input.providerId,
            referenceExternalTransactionId:
                original.externalTransactionId,
            type: 'ROLLBACK',
            status: 'PROCESSED',
        });

        tx.findOne.mockImplementation(
            async (entity: unknown, where?: Record<string, unknown>) => {
                if (entity === Wallet) return wallet;

                if (entity === Transaction) {
                    if (where?.idempotencyKey) return null;

                    if (
                        where?.externalTransactionId ===
                        'rollback-already-reversed'
                    ) {
                        return original;
                    }

                    if (
                        where?.referenceExternalTransactionId ===
                        original.externalTransactionId &&
                        where?.type === 'ROLLBACK'
                    ) {
                        return previousRollback;
                    }

                    return null;
                }

                return null;
            },
        );

        const rollbackInput: CreateTransactionDto = {
            ...input,
            externalTransactionId: 'rollback-duplicate-attempt',
            externalReferenceTransactionId:
                'rollback-already-reversed',
            type: 'ROLLBACK',
            amount: '30.00',
        };

        const result = await service.processTransaction(
            rollbackInput,
            'idem-rollback-duplicate-attempt',
        );

        expect(result.status).toBe('REJECTED');
        expect(result.failureCode).toBe('REFERENCE_ALREADY_REVERSED');
        expect(wallet.balance).toBe('100.00');
        expect(wallet.version).toBe(1);
        expect(ledgerService.createEntry).not.toHaveBeenCalled();
        expect(outboxService.enqueueTransaction).not.toHaveBeenCalled();
    });


    const input: CreateTransactionDto = {
        providerId: 'provider-test',
        externalTransactionId: 'bet-test-001',
        walletId: '2bd0b295-229d-406c-8b99-2b22e2d5be92',
        playerId: 'player-test-001',
        roundId: 'round-test-001',
        gameId: 'game-test-001',
        type: 'BET',
        amount: '30.00',
        currency: 'BRL',
    };

    function hashInput(value: CreateTransactionDto): string {
        return createHash('sha256')
            .update(
                JSON.stringify([
                    value.providerId,
                    value.externalTransactionId,
                    value.walletId,
                    value.playerId,
                    value.roundId,
                    value.gameId,
                    value.type,
                    value.amount,
                    value.currency,
                    value.externalReferenceTransactionId ?? null,
                ]),
            )
            .digest('hex');
    }


    beforeEach(() => {
        wallet = Object.assign(new Wallet(), {
            id: input.walletId,
            playerId: input.playerId,
            currency: 'BRL',
            balance: '100.00',
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        tx = {
            findOne: vi.fn(async (entity: unknown) => {
                if (entity === Transaction) return null;
                if (entity === Wallet) return wallet;
                return null;
            }),
            create: vi.fn((entity: unknown, data: Record<string, unknown>) => {
                const instance =
                    entity === Transaction ? new Transaction() : new Wallet();

                return Object.assign(instance, data);
            }),
            persist: vi.fn(() => ({
                flush: vi.fn().mockResolvedValue(undefined),
            })),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        em = {
            transactional: vi.fn(
                async (callback: (manager: unknown) => Promise<unknown>) =>
                    callback(tx),
            ),
            findOne: vi.fn().mockResolvedValue(null),
        } as unknown as EntityManager;

        ledgerService = {
            createEntry: vi.fn().mockResolvedValue(undefined),
        } as unknown as LedgerService;

        outboxService = {
            enqueueTransaction: vi.fn().mockResolvedValue(undefined),
        } as unknown as OutboxService;

        service = new TransactionsService(
            em,
            ledgerService,
            outboxService,
        );

    });

    it('debita o saldo e registra ledger e outbox para uma BET válida', async () => {
        const result = await service.processTransaction(
            input,
            'idem-bet-test-001',
        );

        expect(result.status).toBe('PROCESSED');
        expect(wallet.balance).toBe('70.00');
        expect(wallet.version).toBe(2);

        expect(ledgerService.createEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                walletId: wallet.id,
                type: 'DEBIT',
                amount: '30.00',
                currency: 'BRL',
            }),
            tx,
        );

        expect(outboxService.enqueueTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                transactionId: result.id,
                type: 'BET',
                status: 'PROCESSED',
            }),
            tx,
        );
    });

    it('rejeita BET sem saldo suficiente sem alterar a carteira', async () => {
        wallet.balance = '20.00';

        const result = await service.processTransaction(
            input,
            'idem-bet-insufficient-001',
        );

        expect(result.status).toBe('REJECTED');
        expect(result.failureCode).toBe('INSUFFICIENT_FUNDS');
        expect(wallet.balance).toBe('20.00');
        expect(wallet.version).toBe(1);

        expect(ledgerService.createEntry).not.toHaveBeenCalled();
        expect(outboxService.enqueueTransaction).not.toHaveBeenCalled();
    });
});
