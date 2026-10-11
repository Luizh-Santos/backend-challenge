import { randomUUID } from 'node:crypto';

export interface IntegrationEventProps<T> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
  data: T;
}

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;
  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: Readonly<T>;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt;
    this.data = Object.freeze(props.data);
  }

  toJSON() {
    return {
      eventId: this.eventId, eventType: this.eventType, aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      ...(this.causationId ? { causationId: this.causationId } : {}),
      occurredAt: this.occurredAt.toISOString(), version: this.version, data: this.data,
    };
  }
}

type Data = Record<string, unknown>;
function props<T>(aggregateId: string, correlationId: string, data: T): IntegrationEventProps<T> {
  return { eventId: randomUUID(), aggregateId, correlationId, occurredAt: new Date(), data };
}

export class WagerTransactionProcessed extends IntegrationEvent<Data> {
  readonly eventType = 'WagerTransactionProcessed'; readonly version = 1;
  static create(aggregateId: string, correlationId: string, data: Data) {
    return new WagerTransactionProcessed(props(aggregateId, correlationId, data));
  }
}
export class WagerTransactionRejected extends IntegrationEvent<Data> {
  readonly eventType = 'WagerTransactionRejected'; readonly version = 1;
  static create(aggregateId: string, correlationId: string, data: Data) {
    return new WagerTransactionRejected(props(aggregateId, correlationId, data));
  }
}
export class WagerTransactionPendingReference extends IntegrationEvent<Data> {
  readonly eventType = 'WagerTransactionPendingReference'; readonly version = 1;
  static create(aggregateId: string, correlationId: string, data: Data) {
    return new WagerTransactionPendingReference(props(aggregateId, correlationId, data));
  }
}
export class WalletBalanceChanged extends IntegrationEvent<Data> {
  readonly eventType = 'WalletBalanceChanged'; readonly version = 1;
  static create(aggregateId: string, correlationId: string, data: Data) {
    return new WalletBalanceChanged(props(aggregateId, correlationId, data));
  }
}
