
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { Wallet } from './wallet.entity.js';
import { WalletsService } from './wallets.service.js';
import { WalletsController } from './wallets.controller.js';
import { LedgerModule } from '../ledger/ledger.module.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([Wallet]),
    LedgerModule,
  ],
  providers: [WalletsService],
  exports: [WalletsService],
  controllers: [WalletsController],
})
export class WalletsModule {}
