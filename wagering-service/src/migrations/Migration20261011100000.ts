import { Migration } from '@mikro-orm/migrations';

export class Migration20261011100000 extends Migration {
  override name = 'Migration20261011100000';

  override up(): void {
    this.addSql(`alter table "transactions" add column "retry_attempts" int not null default 0, add column "next_reference_attempt_at" timestamptz null;`);
    this.addSql(`alter table "transactions" add column "response_balance" numeric(18,2) null;`);
    this.addSql(`alter table "transactions" add constraint "transactions_amount_positive" check (amount > 0), add constraint "transactions_kind_valid" check (type in ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')), add constraint "transactions_status_valid" check (status in ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED'));`);
    this.addSql(`alter table "transactions" add constraint "transactions_wallet_fk" foreign key (wallet_id) references "wallets" (id) on delete restrict;`);
    this.addSql(`create index "transactions_pending_reference_due_idx" on "transactions" ("next_reference_attempt_at") where "status" = 'PENDING_REFERENCE';`);
    this.addSql(`alter table "ledger_entries" add constraint "ledger_entries_direction_valid" check (type in ('CREDIT','DEBIT')), add constraint "ledger_entries_wallet_fk" foreign key (wallet_id) references "wallets" (id) on delete restrict, add constraint "ledger_entries_transaction_fk" foreign key (transaction_id) references "transactions" (id) on delete restrict;`);
    this.addSql(`create function prevent_ledger_mutation() returns trigger language plpgsql as $$ begin raise exception 'ledger entries are immutable'; end; $$;`);
    this.addSql(`create trigger ledger_entries_immutable before update or delete on "ledger_entries" for each row execute function prevent_ledger_mutation();`);
    this.addSql(`alter table "inbox_events" drop constraint "inbox_events_event_id_unique";`);
    this.addSql(`alter table "inbox_events" add column "consumer_name" varchar(128) null, add column "message_id" varchar(255) null, add column "payload_hash" varchar(64) null;`);
    this.addSql(`update "inbox_events" set "consumer_name" = 'wager-transaction-consumer', "message_id" = "event_id", "payload_hash" = repeat('0', 64);`);
    this.addSql(`alter table "inbox_events" alter column "consumer_name" set not null, alter column "message_id" set not null, alter column "payload_hash" set not null;`);
    this.addSql(`alter table "inbox_events" add constraint "inbox_consumer_message_unique" unique ("consumer_name", "message_id");`);
    this.addSql(`alter table "wallets" add constraint "wallets_currency_format" check (currency ~ '^[A-Z]{3}$');`);
    this.addSql(`alter table "outbox_events" add constraint "outbox_attempts_non_negative" check (attempts >= 0);`);
  }

  override down(): void {
    this.addSql(`alter table "outbox_events" drop constraint "outbox_attempts_non_negative";`);
    this.addSql(`alter table "wallets" drop constraint "wallets_currency_format";`);
    this.addSql(`alter table "inbox_events" drop constraint "inbox_consumer_message_unique";`);
    this.addSql(`alter table "inbox_events" drop column "consumer_name", drop column "message_id", drop column "payload_hash";`);
    this.addSql(`alter table "inbox_events" add constraint "inbox_events_event_id_unique" unique ("event_id");`);
    this.addSql(`drop trigger "ledger_entries_immutable" on "ledger_entries";`);
    this.addSql(`drop function prevent_ledger_mutation();`);
    this.addSql(`alter table "ledger_entries" drop constraint "ledger_entries_direction_valid", drop constraint "ledger_entries_wallet_fk", drop constraint "ledger_entries_transaction_fk";`);
    this.addSql(`drop index "transactions_pending_reference_due_idx";`);
    this.addSql(`alter table "transactions" drop constraint "transactions_amount_positive", drop constraint "transactions_kind_valid", drop constraint "transactions_status_valid", drop constraint "transactions_wallet_fk", drop column "retry_attempts", drop column "next_reference_attempt_at", drop column "response_balance";`);
  }
}
