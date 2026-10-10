
import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { LedgerService } from './ledger.service.js';

@Controller('wallets/:walletId/ledger')
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
  ) {}

  @Get()
  async findByWallet(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const pageSize = limit === undefined ? 20 : Number(limit);

    return this.ledgerService.findByWallet(
      walletId,
      cursor,
      pageSize,
    );
  }
}
