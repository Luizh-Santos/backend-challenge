import { Migration } from '@mikro-orm/migrations';

export class Migration20261010140005 extends Migration {

  override name = 'Migration20261010140005';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wallets" drop constraint "wallets_player_id_unique";`);
    this.addSql(`alter table "wallets" add "currency" varchar(255) not null default 'BRL', add "version" int not null default 1;`);
    this.addSql(`alter table "wallets" add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");`);
    this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check (balance >= 0);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wallets" drop constraint "wallets_player_id_currency_unique";`);
    this.addSql(`alter table "wallets" drop constraint "wallets_balance_non_negative";`);
    this.addSql(`alter table "wallets" drop column "currency", drop column "version";`);
    this.addSql(`alter table "wallets" add constraint "wallets_player_id_unique" unique ("player_id");`);
  }

}
