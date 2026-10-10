import { Migration } from '@mikro-orm/migrations';

export class Migration20261010140335 extends Migration {

  override name = 'Migration20261010140335';

  override up(): void | Promise<void> {
    this.addSql(`create table "ledger_entries" ("id" uuid not null, "transaction_id" uuid not null, "wallet_id" uuid not null, "type" varchar(255) not null, "amount" numeric(18,2) not null, "currency" varchar(255) not null default 'BRL', "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "ledger_entries" add constraint "ledger_entries_transaction_wallet_unique" unique ("transaction_id", "wallet_id");`);

    this.addSql(`alter table "ledger_entries" add constraint "ledger_entries_amount_positive" check (amount > 0);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "ledger_entries" cascade;`);
  }

}
