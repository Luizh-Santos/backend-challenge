
import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
  Check,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'ledger_entries' })
@Unique({
  name: 'ledger_entries_transaction_wallet_unique',
  properties: ['transactionId', 'walletId'],
})
@Check({
  name: 'ledger_entries_amount_positive',
  expression: 'amount > 0',
})
export class LedgerEntry {
  @PrimaryKey({ type: 'uuid' })
  id: string = crypto.randomUUID();

  @Property({ type: 'uuid' })
  transactionId!: string;

  @Property({ type: 'uuid' })
  walletId!: string;

  @Property({ type: 'string' })
  type!: string;

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  amount!: string;

  @Property({ type: 'string' })
  currency: string = 'BRL';

  @Property({ type: 'Date' })
  createdAt: Date = new Date();
}
