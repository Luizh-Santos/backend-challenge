
import {
  Entity,
  PrimaryKey,
  Property,
  Index,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'outbox_events' })
@Index({ properties: ['status', 'createdAt'] })
export class OutboxEvent {
  @PrimaryKey({ type: 'uuid' })
  id: string = crypto.randomUUID();

  @Property({ type: 'string' })
  eventType!: string;

  @Property({ type: 'uuid' })
  aggregateId!: string;

  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  @Property({ type: 'string' })
  status: string = 'PENDING';

  @Property({ type: 'integer' })
  attempts = 0;

  @Property({ type: 'Date' })
  createdAt: Date = new Date();

  @Property({ type: 'Date', nullable: true })
  publishedAt?: Date;

  @Property({ type: 'Date', nullable: true })
  nextAttemptAt?: Date;

  @Property({ type: 'string', nullable: true })
  lastError?: string;
}
