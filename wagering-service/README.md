# Wagering Service

Serviço NestJS para processar apostas com PostgreSQL, MikroORM e SQS. As quantias chegam como strings decimais de duas casas e são calculadas com `bigint` em centavos. A wallet é bloqueada dentro da transação financeira; ledger, inbox e outbox são persistidos no mesmo commit.

## Requisitos

- Bun 1.x
- Docker Compose

## Ambiente local

Na raiz do repositório, inicie PostgreSQL e LocalStack:

```sh
docker compose up -d
```

No diretório `wagering-service`, instale dependências e aplique as migrations:

```sh
bun install
bunx mikro-orm migration:up
bun run start:dev
```

A API usa `http://localhost:3000`. Os workers de Inbox, Outbox e referências pendentes iniciam junto com a aplicação.

## Endpoints principais

- `POST /wallets` — cria wallet com `initialBalance: { amount, currency }`.
- `GET /wallets/:walletId` — consulta saldo e versão.
- `GET /wallets/:walletId/ledger?cursor=...&limit=50` — consulta ledger paginado.
- `POST /wallets/:walletId/reconciliation` — compara saldo materializado ao ledger.
- `POST /wagering/transactions` — processa uma operação; exige `Idempotency-Key`.
- `GET /wagering/transactions/:transactionId` — consulta por ID interno.
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId` — consulta por ID do provedor.
- `GET /health/live` e `GET /health/ready` — liveness e readiness.
- `GET /metrics` — métricas Prometheus locais à instância.

O corpo de transação aceita `kind` e `money: { amount, currency }`, conforme o contrato do desafio. Os aliases `type`, `amount` e `currency` continuam aceitos durante a transição.

## Configuração

PostgreSQL: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.

SQS: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SQS_ENDPOINT`, `SQS_QUEUE_URL` (entrada), `SQS_EVENTS_QUEUE_URL` (eventos) e `SQS_DLQ_URL`.

## Comandos

```sh
bun run build
bun run test
bun run test:e2e
bun run lint
bun run test:cov
```

As alterações recentes não foram verificadas executando estes comandos. Os testes de concorrência com múltiplas instâncias e de falha/recuperação com PostgreSQL e LocalStack reais ainda precisam ser ampliados conforme `ARCHITECTURE.md` e o README do desafio.

## Operação

Os pedidos são consumidos da `wager-transactions.fifo`; eventos da Outbox são publicados em `wager-integration-events.fifo`. O LocalStack também configura `wager-transactions-dlq.fifo` com redrive após cinco recebimentos. Eventos publicados podem ser entregues mais de uma vez; consumidores devem deduplicar pelo `eventId`.

Autenticação OIDC não está implementada. O desenho proposto para um ambiente protegido está descrito em `ARCHITECTURE.md`.
