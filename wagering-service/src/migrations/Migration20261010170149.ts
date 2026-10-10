import { Migration } from '@mikro-orm/migrations';

export class Migration20261010170149 extends Migration {

  override name = 'Migration20261010170149';

  override up(): void | Promise<void> {
    this.addSql(`create table "outbox_events" ("id" uuid not null, "event_type" varchar(255) not null, "aggregate_id" uuid not null, "payload" jsonb not null, "status" varchar(255) not null default 'PENDING', "attempts" int not null default 0, "created_at" timestamptz not null, "published_at" timestamptz null, "next_attempt_at" timestamptz null, "last_error" varchar(255) null, primary key ("id"));`);
    this.addSql(`create index "outbox_events_status_created_at_index" on "outbox_events" ("status", "created_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "outbox_events" cascade;`);
  }

}
