
import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
  Index,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'inbox_events' })
@Unique({ properties: ['eventId'] })
@Index({ properties: ['status', 'receivedAt'] })
export class InboxEvent {
  @PrimaryKey({ type: 'uuid' })
  id: string = crypto.randomUUID();

  @Property({ type: 'string' })
  eventId!: string;

  @Property({ type: 'string' })
  eventType!: string;

  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  @Property({ type: 'string' })
  status: string = 'RECEIVED';

  @Property({ type: 'Date' })
  receivedAt: Date = new Date();

  @Property({ type: 'Date', nullable: true })
  processedAt?: Date;
}
