
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  BadRequestException,
} from '@nestjs/common';

import { WalletsService } from './wallets.service.js';

interface CreateWalletBody {
  playerId?: string;
  initialBalance?: string;
  currency?: string;
}

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
  ) {}

  @Post()
  async create(@Body() body: CreateWalletBody) {
    if (
      typeof body.playerId !== 'string' ||
      !body.playerId.trim()
    ) {
      throw new BadRequestException('playerId é obrigatório');
    }

    if (
      typeof body.initialBalance !== 'string' ||
      !body.initialBalance.trim()
    ) {
      throw new BadRequestException(
        'initialBalance é obrigatório',
      );
    }

    const currency = body.currency ?? 'BRL';

    if (typeof currency !== 'string') {
      throw new BadRequestException(
        'currency deve ser um texto',
      );
    }

    return this.walletsService.create(
      body.playerId.trim(),
      body.initialBalance,
      currency,
    );
  }

  @Get(':walletId')
  async findById(@Param('walletId') walletId: string) {
    return this.walletsService.findById(walletId);
  }
}
