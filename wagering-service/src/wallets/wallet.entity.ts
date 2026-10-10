import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
  Check,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallets' })
@Unique({ properties: ['playerId', 'currency'] })
@Check({
  name: 'wallets_balance_non_negative',
  expression: 'balance >= 0',
})
export class Wallet {
  @PrimaryKey({ type: 'uuid' })
  id: string = crypto.randomUUID();

  @Property({ type: 'string' })
  playerId!: string;

  @Property({ type: 'string' })
  currency: string = 'BRL';

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  balance: string = '0.00';

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'Date' })
  createdAt: Date = new Date();

  @Property({ type: 'Date', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}