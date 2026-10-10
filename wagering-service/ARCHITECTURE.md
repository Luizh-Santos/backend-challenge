# Arquitetura — Wagering Service

## 1. Visão geral

O Wagering Service é uma aplicação desenvolvida com NestJS e PostgreSQL para processar transações de apostas, gerenciar saldos de carteiras, registrar movimentações financeiras no Ledger e publicar eventos por meio de uma fila Amazon SQS FIFO.

O ambiente local utiliza Docker Compose e LocalStack para disponibilizar o PostgreSQL e simular o SQS.

## 2. Tecnologias utilizadas

- **Runtime:** Node.js
- **Linguagem:** TypeScript
- **Framework:** NestJS
- **Banco de dados:** PostgreSQL
- **ORM e migrations:** MikroORM
- **Mensageria:** Amazon SQS FIFO, simulado localmente pelo LocalStack
- **Gerenciador de pacotes:** Bun
- **Testes:** Vitest e Supertest
- **Infraestrutura local:** Docker Compose

## 3. Principais componentes

### 3.1. Wallets — Carteiras

Responsável pela criação de carteiras e pela consulta de seus saldos.

Endpoints disponíveis:

- `POST /wallets` — cria uma carteira.
- `GET /wallets/:walletId` — consulta uma carteira pelo identificador.

As atualizações de saldo incrementam o campo `version` e atualizam a data da última modificação.

### 3.2. Transactions — Transações financeiras

Responsável pelo processamento dos seguintes tipos de transação:

- `BET` — débito referente a uma aposta.
- `WIN` — crédito referente a um ganho.
- `LOSS` — registro de uma perda, sem movimentação do saldo da carteira.
- `REFUND` — reembolso de uma aposta válida.
- `ROLLBACK` — reversão de uma transação processada válida, conforme as regras implementadas.

Endpoints disponíveis:

- `POST /wagering/transactions` — processa uma transação.
- `GET /wagering/transactions/:id` — consulta uma transação pelo identificador.

O serviço utiliza valores monetários convertidos para centavos inteiros durante os cálculos de saldo. Também valida os valores recebidos, verifica as informações da carteira e aplica bloqueio pessimista durante o processamento financeiro.

As chaves de idempotência são associadas a um hash do conteúdo da requisição. A reutilização de uma chave com conteúdo diferente gera um conflito.

### 3.3. Ledger — Histórico financeiro

Responsável pelo registro das movimentações financeiras associadas às transações e carteiras.

Endpoint disponível:

- `GET /wallets/:walletId/ledger` — consulta o histórico financeiro de uma carteira.

O serviço oferece paginação baseada em cursor, com ordenação decrescente pela data de criação e pelo identificador do lançamento.

### 3.4. Outbox — Publicação confiável de eventos

A tabela `outbox_events` armazena eventos que precisam ser publicados no SQS.

Os eventos são registrados no PostgreSQL dentro da mesma transação de banco utilizada para a operação financeira correspondente. Isso evita confirmar uma movimentação financeira sem persistir seu evento associado, nos caminhos em que a Outbox está integrada.

O publicador consulta os eventos pendentes utilizando `FOR UPDATE SKIP LOCKED`, marca os eventos selecionados como `PROCESSING` e tenta publicá-los no SQS.

Quando a publicação é bem-sucedida, o evento passa para `PUBLISHED`. Quando ocorre uma falha, o evento retorna para `PENDING` e recebe uma data prevista para nova tentativa.

O campo `attempts` registra as tentativas de publicação. Eventos que permanecerem em `PROCESSING` além do prazo de recuperação podem ser selecionados novamente pelo publicador.

### 3.5. SQS — Mensageria

O serviço SQS é responsável pelo envio e recebimento de mensagens.

A fila principal utiliza o padrão FIFO. O identificador da carteira é utilizado como grupo de mensagens, enquanto o identificador da transação é utilizado como identificador de deduplicação da mensagem.

Filas configuradas no ambiente local:

- `wager-transactions.fifo` — fila principal de eventos.
- `wager-transactions-dlq.fifo` — Dead Letter Queue (DLQ), destinada às mensagens que atingirem o limite de recebimentos configurado sem serem removidas da fila principal.

A política de redirecionamento está configurada para encaminhar mensagens após cinco recebimentos sem processamento concluído.

### 3.6. Inbox — Registro de mensagens recebidas

A tabela `inbox_events` registra os eventos recebidos do SQS.

O campo `event_id` possui uma restrição de unicidade no PostgreSQL, permitindo reconhecer mensagens que já foram registradas e evitar a criação de registros duplicados.

O consumidor executa o seguinte fluxo:

1. Recebe a mensagem do SQS.
2. Valida o conteúdo da mensagem.
3. Registra o evento no PostgreSQL, caso ainda não exista.
4. Aguarda a conclusão do registro no banco.
5. Remove a mensagem da fila utilizando o `ReceiptHandle`.

Se o registro falhar, a mensagem não é removida e poderá ser entregue novamente pelo SQS.

O consumidor atual registra e deduplica eventos recebidos. Ele não executa novamente a movimentação financeira original.

## 4. Fluxo de processamento financeiro

O processamento de uma transação segue estas etapas:

1. A API recebe a requisição.
2. O serviço valida os dados e calcula o hash do conteúdo.
3. A chave de idempotência é verificada.
4. A transação é registrada no contexto transacional do PostgreSQL.
5. A carteira é bloqueada para evitar movimentações concorrentes incompatíveis.
6. As regras financeiras e os dados de referência são validados.
7. Quando necessário, o saldo da carteira é atualizado.
8. O lançamento no Ledger e o evento Outbox são registrados dentro da mesma transação, nos caminhos de movimentação financeira bem-sucedida.
9. A transação do PostgreSQL é confirmada.
10. O publicador envia os eventos pendentes ao SQS.
11. O consumidor registra os eventos recebidos na Inbox e confirma as mensagens no SQS.

O tipo `LOSS` registra o resultado da transação sem alterar o saldo da carteira.

## 5. Consistência e tratamento de falhas

O sistema utiliza mecanismos para reduzir inconsistências e proteger as