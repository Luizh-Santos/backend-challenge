
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  BadRequestException,
} from '@nestjs/common';
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
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(
        'O cabeçalho Idempotency-Key é obrigatório',
      );
    }

    return this.transactionsService.processTransaction(body, idempotencyKey);
    };
  }
