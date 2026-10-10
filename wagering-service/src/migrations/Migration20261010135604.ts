import { Migration } from '@mikro-orm/migrations';

export class Migration20261010135604 extends Migration {

  override name = 'Migration20261010135604';

  override up(): void | Promise<void> {
    this.addSql(`create table "transactions" ("id" uuid not null, "provider_id" varchar(255) not null, "external_transaction_id" varchar(255) not null, "idempotency_key" varchar(255) not null, "payload_hash" varchar(255) not null, "wallet_id" uuid not null, "player_id" varchar(255) not null, "round_id" varchar(255) not null, "game_id" varchar(255) not null, "type" varchar(255) not null, "amount" numeric(18,2) not null, "currency" varchar(255) not null default 'BRL', "reference_external_transaction_id" varchar(255) null, "status" varchar(255) not null default 'PENDING', "failure_code" varchar(255) null, "processed_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "transactions" add constraint "transactions_idempotency_key_unique" unique ("idempotency_key");`);
    this.addSql(`create index "transactions_wallet_id_created_at_index" on "transactions" ("wallet_id", "created_at");`);
    this.addSql(`alter table "transactions" add constraint "transactions_provider_id_external_transaction_id_unique" unique ("provider_id", "external_transaction_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "transactions" cascade;`);
  }

}
