
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  BadRequestException,
} from '@nestjs/common';

import { WalletsService } from './wallets.service.js';
import { LedgerService } from '../ledger/ledger.service.js';

interface CreateWalletBody {
  playerId?: string;
  initialBalance?: string | { amount?: string; currency?: string };
  currency?: string;
}

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly ledgerService: LedgerService,
  ) {}

  @Post()
  async create(@Body() body: CreateWalletBody) {
    if (
      typeof body.playerId !== 'string' ||
      !body.playerId.trim()
    ) {
      throw new BadRequestException('playerId é obrigatório');
    }

    const initialAmount = typeof body.initialBalance === 'string'
      ? body.initialBalance : body.initialBalance?.amount;
    const currency = typeof body.initialBalance === 'object' && body.initialBalance?.currency
      ? body.initialBalance.currency : body.currency ?? 'BRL';
    if (typeof initialAmount !== 'string' || !initialAmount.trim()) {
      throw new BadRequestException(
        'initialBalance é obrigatório',
      );
    }

    if (typeof currency !== 'string') {
      throw new BadRequestException(
        'currency deve ser um texto',
      );
    }

    const wallet = await this.walletsService.create(
      body.playerId.trim(),
      initialAmount,
      currency,
    );
    return {
      id: wallet.id, playerId: wallet.playerId,
      balance: { amount: wallet.balance, currency: wallet.currency }, version: wallet.version,
    };
  }

  @Get(':walletId')
  async findById(@Param('walletId') walletId: string) {
    const wallet = await this.walletsService.findById(walletId);
    return {
      id: wallet.id, playerId: wallet.playerId,
      balance: { amount: wallet.balance, currency: wallet.currency }, version: wallet.version,
    };
  }

  @Post(':walletId/reconciliation')
  async reconcile(@Param('walletId') walletId: string) {
    return this.ledgerService.reconcile(walletId);
  }
}
