Arquitetura — Wagering Service
1. Visão geral
O Wagering Service é uma aplicação desenvolvida com NestJS e PostgreSQL para processar transações de apostas, gerenciar saldos de carteiras, registrar movimentações financeiras no Ledger e publicar eventos por meio de uma fila Amazon SQS FIFO.
O ambiente local utiliza Docker Compose e LocalStack para disponibilizar o PostgreSQL e simular o SQS.
2. Tecnologias utilizadas
- Runtime e gerenciador: Bun 1.x
- Linguagem: TypeScript
- Framework: NestJS
- Banco de dados: PostgreSQL
- ORM e migrations: MikroORM
- Mensageria: Amazon SQS FIFO, simulado localmente pelo LocalStack
- Gerenciador de pacotes: Bun
- Testes: Vitest e Supertest
- Infraestrutura local: Docker Compose
3. Principais componentes
3.1. Wallets — Carteiras
Responsável pela criação de carteiras e pela consulta de seus saldos.
Endpoints disponíveis:
- POST /wallets — cria uma carteira.
- GET /wallets/:walletId — consulta uma carteira pelo identificador.
As atualizações de saldo incrementam o campo version e atualizam a data da última modificação.
3.2. Transactions — Transações financeiras
Responsável pelo processamento dos seguintes tipos de transação:
- BET — débito referente a uma aposta.
- WIN — crédito referente a um ganho.
- LOSS — registro de uma perda, sem movimentação do saldo da carteira.
- REFUND — reembolso de uma aposta válida.
- ROLLBACK — reversão de uma transação processada válida, conforme as regras implementadas.
Endpoints disponíveis:
- POST /wagering/transactions — processa uma transação.
- GET /wagering/transactions/:id — consulta uma transação pelo identificador.
O serviço utiliza valores monetários convertidos para centavos inteiros durante os cálculos de saldo. Também valida os valores recebidos, verifica as informações da carteira e aplica bloqueio pessimista durante o processamento financeiro.
As chaves de idempotência são associadas a um hash do conteúdo da requisição. A reutilização de uma chave com conteúdo diferente gera um conflito.
3.3. Ledger — Histórico financeiro
Responsável pelo registro das movimentações financeiras associadas às transações e carteiras.
Endpoint disponível:
- GET /wallets/:walletId/ledger — consulta o histórico financeiro de uma carteira.
O serviço oferece paginação baseada em cursor, com ordenação decrescente pela data de criação e pelo identificador do lançamento.
3.4. Outbox — Publicação confiável de eventos
A tabela outbox_events armazena eventos que precisam ser publicados no SQS.
Os eventos são registrados no PostgreSQL dentro da mesma transação de banco utilizada para a operação financeira correspondente. Isso evita confirmar uma movimentação financeira sem persistir seu evento associado, nos caminhos em que a Outbox está integrada.
O publicador consulta os eventos pendentes utilizando FOR UPDATE SKIP LOCKED, marca os eventos selecionados como PROCESSING e tenta publicá-los no SQS.
Quando a publicação é bem-sucedida, o evento passa para PUBLISHED. Quando ocorre uma falha, o evento retorna para PENDING e recebe uma data prevista para nova tentativa.
O campo attempts registra as tentativas de publicação. Eventos que permanecerem em PROCESSING além do prazo de recuperação podem ser selecionados novamente pelo publicador.
3.5. SQS — Mensageria
O serviço SQS é responsável pelo envio e recebimento de mensagens.
A fila principal utiliza o padrão FIFO. O identificador da carteira é utilizado como grupo de mensagens, enquanto o identificador da transação é utilizado como identificador de deduplicação da mensagem.
Filas configuradas no ambiente local:
- wager-transactions.fifo — fila principal de eventos.
- wager-transactions-dlq.fifo — Dead Letter Queue (DLQ), destinada às mensagens que atingirem o limite de recebimentos configurado sem serem removidas da fila principal.
A política de redirecionamento está configurada para encaminhar mensagens após cinco recebimentos sem processamento concluído.
3.6. Inbox — Registro de mensagens recebidas
A tabela inbox_events registra os eventos recebidos do SQS.
O campo event_id possui uma restrição de unicidade no PostgreSQL, permitindo reconhecer mensagens que já foram registradas e evitar a criação de registros duplicados.
O consumidor executa o seguinte fluxo:
1. Recebe a mensagem do SQS.
2. Valida o conteúdo da mensagem.
3. Registra o evento no PostgreSQL, caso ainda não exista.
4. Aguarda a conclusão do registro no banco.
5. Remove a mensagem da fila utilizando o ReceiptHandle.
Se o registro falhar, a mensagem não é removida e poderá ser entregue novamente pelo SQS.
O consumidor valida mensagens `WagerTransactionRequested`, registra a Inbox com chave `(consumerName, messageId)` e chama o mesmo `TransactionsService` usado pela API. A Inbox, transação, ledger e outbox são confirmados no mesmo contexto PostgreSQL; a mensagem só é removida após o commit. Eventos publicados pela Outbox vão para uma fila de integração separada, evitando que a aplicação consuma os próprios eventos como novos pedidos.
4. Fluxo de processamento financeiro
O processamento de uma transação segue estas etapas:
1. A API recebe a requisição.
2. O serviço valida os dados e calcula o hash do conteúdo.
3. A chave de idempotência é verificada.
4. A transação é registrada no contexto transacional do PostgreSQL.
5. A carteira é bloqueada para evitar movimentações concorrentes incompatíveis.
6. As regras financeiras e os dados de referência são validados.
7. Quando necessário, o saldo da carteira é atualizado.
8. O lançamento no Ledger, a Inbox quando aplicável e os eventos Outbox são registrados dentro da mesma transação.
9. A transação do PostgreSQL é confirmada.
10. O publicador envia os eventos pendentes ao SQS.
11. O consumidor registra os eventos recebidos na Inbox e confirma as mensagens no SQS.
O tipo LOSS registra o resultado da transação sem alterar o saldo da carteira.
5. Consistência e tratamento de falhas
O sistema utiliza mecanismos para reduzir inconsistências e proteger as operações financeiras:
- Transações PostgreSQL: mantêm operações relacionadas no mesmo contexto transacional.
- Bloqueio pessimista: serializa operações concorrentes sobre a mesma carteira.
- Idempotência: evita processar novamente uma requisição já registrada com a mesma chave e o mesmo conteúdo.
- Ledger: registra as movimentações financeiras realizadas.
- Outbox: persiste os eventos a publicar junto com a operação financeira correspondente.
- Novas tentativas: permitem repetir publicações que falharam temporariamente.
- Inbox: utiliza uma restrição única para evitar duplicar registros de eventos.
- Dead Letter Queue: permite isolar mensagens que não foram concluídas após várias entregas.
A publicação no SQS e a atualização do estado da Outbox não constituem uma única transação atômica. Assim, se a publicação for concluída, mas a atualização da Outbox falhar, uma mensagem poderá ser publicada novamente.
Por esse motivo, o processamento de mensagens deve ser idempotente, e os consumidores precisam considerar possíveis entregas duplicadas.
6. Ambiente de desenvolvimento
Pré-requisitos
- Node.js
- Bun
- Docker Desktop
Iniciar a infraestrutura
Na raiz do projeto, execute:
docker compose up -d
Esse comando inicia os serviços definidos no Docker Compose, incluindo o PostgreSQL e o LocalStack.
Iniciar a API
No diretório do serviço:
bun run start:dev
Compilar o projeto
bun run build
Executar os testes unitários
bun run test
Executar os testes E2E
bun run test:e2e
Executar o lint
bun run lint
Gerar o relatório de cobertura
bun run test:cov
7. Configuração por variáveis de ambiente
PostgreSQL
As seguintes variáveis permitem configurar a conexão com o banco de dados:
- DB_HOST
- DB_PORT
- DB_USER
- DB_PASSWORD
- DB_NAME
SQS
As seguintes variáveis permitem configurar a integração com o SQS:
- AWS_REGION
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- SQS_ENDPOINT
- SQS_QUEUE_URL
No desenvolvimento local, o serviço utiliza o endpoint do LocalStack e credenciais de teste. Credenciais para ambientes externos devem ser fornecidas por um mecanismo seguro de configuração e não devem ser adicionadas ao repositório.
O LocalStack também exige configuração de autenticação compatível com a licença utilizada no ambiente.
8. Testes realizados e limitações conhecidas
Na última verificação registrada, o projeto apresentou os seguintes resultados:
- 38 testes unitários aprovados.
- 1 teste E2E isolado aprovado.
- Compilação sem erros.
- Lint sem erros, mas com avisos pendentes.
- Cobertura de linhas reportada de 77,19%.
Também foi realizado um teste manual de concorrência no PostgreSQL real. Duas apostas simultâneas de R$ 30,00 disputaram uma carteira com saldo inicial de R$ 30,00. Uma foi processada e a outra foi rejeitada por saldo insuficiente. O saldo final ficou em R$ 0,00, com a versão da carteira incrementada para 2.
O teste E2E atual valida o endpoint raiz com módulos isolados. Ele não comprova, por si só, a integração completa da API financeira com o PostgreSQL e o SQS.
Antes de utilizar o sistema em produção, ainda devem ser ampliados os testes automatizados de integração para concorrência no banco, interrupções do processo, recuperação da Outbox, reentrega de mensagens, deduplicação após reinicializações e cenários de falha entre a publicação no SQS e a atualização do estado da Outbox.
Os resultados apresentados descrevem os comportamentos efetivamente testados até o momento e não significam que todos os requisitos de produção tenham sido concluídos.

## Decisões e limites da implementação

- **Autenticação:** não implementada por não pontuar no desafio. A API permanece sem guard; para implantação, integrar um IdP OIDC (por exemplo Keycloak) via `ProviderIdentityPort`/guard. Health checks ficam abertos e a fila é considerada canal interno confiável.
- **Dinheiro:** contratos usam strings decimais com duas casas; cálculos de saldo convertem para `bigint` em centavos. O PostgreSQL persiste `numeric(18,2)`. Não usar `number` para valores monetários.
- **Concorrência:** `SELECT ... FOR UPDATE` via lock pessimista na wallet serializa movimentações da mesma carteira. Unicidades e checks no PostgreSQL protegem wallet, idempotência, ledger e saldos; uma migration adiciona FKs e trigger que rejeita UPDATE/DELETE do ledger.
- **Idempotência:** SHA-256 de JSON canônico com campos de negócio ordenados; o header não entra no hash. A Inbox usa o par de consumidor e `MessageId`, e executa processamento e registro no mesmo escopo transacional.
- **Eventos:** `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference` e `WalletBalanceChanged` são gravados na Outbox antes do commit. O publisher usa `SKIP LOCKED`; falha após envio pode gerar duplicata, então consumidores externos devem deduplicar por `eventId`.
- **Referências fora de ordem:** worker consulta operações pendentes com backoff exponencial limitado a 300 segundos e rejeita após dez tentativas com `REFERENCE_NOT_FOUND`.
- **Filas:** pedidos entram em `wager-transactions.fifo`; eventos publicados saem por `wager-integration-events.fifo`. A DLQ mantém o limite de cinco recebimentos configurado no LocalStack.
- **Observabilidade:** `/metrics` publica contadores locais do processo, retries, DLQ, conflitos de lock, duração e atraso da Outbox. As métricas são por instância e não substituem um backend centralizado.
