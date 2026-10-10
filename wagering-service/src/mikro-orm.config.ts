
import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

const isVitest = process.env.VITEST === 'true';

export default defineConfig({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'jungle',
  password: process.env.DB_PASSWORD ?? 'local_dev_password',
  dbName: process.env.DB_NAME ?? 'jungle_gaming',
  extensions: [Migrator],
  entities: ['./dist/**/*.entity.js'],
  ...(isVitest ? {} : { entitiesTs: ['./src/**/*.entity.ts'] }),
  migrations: {
    path: './dist/migrations',
    pathTs: './src/migrations',
  },
});
