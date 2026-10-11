
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  BadRequestException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { TransactionsService } from './transaction.service.js';
import { CreateTransactionDto } from './create-transaction.dto.js';

@Controller('wagering/transactions')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
  ) {}

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.transactionsService.findById(id);
  }

  @Post()
  async create(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: CreateTransactionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(
        'O cabeçalho Idempotency-Key é obrigatório',
      );
    }

    const transaction = await this.transactionsService.processTransaction(body, idempotencyKey);
    if (transaction.status === 'PENDING' || transaction.status === 'PENDING_REFERENCE') response.status(202);
    else if (transaction.status === 'REJECTED') response.status(422);
    else if (transaction.idempotentReplay) response.status(200);
    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance: transaction.responseBalance
        ? { amount: transaction.responseBalance, currency: transaction.currency }
        : undefined,
      idempotentReplay: transaction.idempotentReplay,
      ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
    };
  }
}

@Controller('providers/:providerId/wagering/transactions')
export class ProviderTransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}
  @Get(':externalTransactionId')
  findByProviderExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalId: string,
  ) {
    return this.transactionsService.findByProviderExternalId(providerId, externalId);
  }
}
