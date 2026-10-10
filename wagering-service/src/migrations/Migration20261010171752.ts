import { Migration } from '@mikro-orm/migrations';

export class Migration20261010171752 extends Migration {

  override name = 'Migration20261010171752';

  override up(): void | Promise<void> {
    this.addSql(`create table "inbox_events" ("id" uuid not null, "event_id" varchar(255) not null, "event_type" varchar(255) not null, "payload" jsonb not null, "status" varchar(255) not null default 'RECEIVED', "received_at" timestamptz not null, "processed_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "inbox_events_status_received_at_index" on "inbox_events" ("status", "received_at");`);
    this.addSql(`alter table "inbox_events" add constraint "inbox_events_event_id_unique" unique ("event_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "inbox_events" cascade;`);
  }

}
