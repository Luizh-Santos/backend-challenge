import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
  Index,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'transactions' })
@Unique({ properties: ['providerId', 'externalTransactionId'] })
@Index({ properties: ['walletId', 'createdAt'] })
export class Transaction {
  @PrimaryKey({ type: 'uuid' })
  id: string = crypto.randomUUID();

  @Property({ type: 'string' })
  providerId!: string;

  @Property({ type: 'string' })
  externalTransactionId!: string;

  @Property({ type: 'string' })
  @Unique()
  idempotencyKey!: string;

  @Property({ type: 'string' })
  payloadHash!: string;

  @Property({ type: 'uuid' })
  walletId!: string;

  @Property({ type: 'string' })
  playerId!: string;

  @Property({ type: 'string' })
  roundId!: string;

  @Property({ type: 'string' })
  gameId!: string;

  @Property({ type: 'string' })
  type!: string;

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  amount!: string;

  @Property({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  responseBalance?: string;

  @Property({ type: 'string' })
  currency: string = 'BRL';

  @Property({ type: 'string', nullable: true })
  referenceExternalTransactionId?: string;

  @Property({ type: 'string' })
  status: string = 'PENDING';

  @Property({ type: 'string', nullable: true })
  failureCode?: string;

  @Property({ type: 'Date', nullable: true })
  processedAt?: Date;

  @Property({ type: 'integer' })
  retryAttempts = 0;

  @Property({ type: 'Date', nullable: true })
  nextReferenceAttemptAt?: Date;

  @Property({ type: 'Date' })
  createdAt: Date = new Date();

  idempotentReplay = false;
}
