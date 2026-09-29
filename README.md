# Achadinhos 🛍️

Ferramenta interna para o time de suporte/desenvolvimento enviar **ofertas de
produtos** (com link de afiliado) para grupos do WhatsApp, usando a **UAZAPI**
como provedor.

Cada membro do time tem seu próprio login e sua própria conexão do WhatsApp
(um número por usuário). O fluxo principal é:

1. **Login** → cada suporte entra com e-mail e senha.
2. **Conexão** → conecta seu número lendo o QR Code (ou por código de pareamento).
3. **Grupos** → lista os grupos do número conectado e seleciona os alvos.
4. **Produtos** → classifica um lote JSON na página `/painel/products`, escolhe e salva os produtos em um catálogo pessoal.
5. **Nova campanha** → seleciona produtos do catálogo e os grupos de destino.
6. **Segurança** → define intervalo entre mensagens, limite por hora, aquecimento e embaralhamento.
7. **Enviar / Agendar** → dispara na hora ou agenda; acompanha o progresso e os logs.

Construído reaproveitando a base sólida do projeto `repasses` (UazapiClient,
padrões de erro, lifecycle de conexão, stack de frontend), porém **enxuto e
focado apenas em UAZAPI** — sem Z-API, sem CRM, sem veículos.

## Estrutura

```
achadinhos-project/
├── achadinhos-backend/    # Express + TS + Sequelize/Postgres + tsyringe
└── achadinhos-frontend/   # React 19 + Vite + Tailwind + TanStack Query
```

## Pré-requisitos

- Node.js ≥ 22 (AI SDK v7 e provedor OpenRouter)
- Docker (para o Postgres local)
- Um **UAZAPI_ADMIN_TOKEN** (para provisionar instâncias) e a base URL da UAZAPI

## Subindo o backend

```bash
cd achadinhos-backend
cp env.example .env          # ajuste JWT_SECRET, UAZAPI_ADMIN_TOKEN, etc.
npm install
npm run docker:up            # sobe o Postgres em localhost:5433
npm run migrate              # cria as tabelas
npm run dev                  # http://localhost:3100/api/v1
```

Na primeira subida, se `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`
estiverem definidos e a tabela de usuários estiver vazia, um usuário **ADMIN** é
criado automaticamente. Alternativamente, o **primeiro** cadastro via
`POST /auth/register` (quando não há nenhum usuário) vira ADMIN.

### Configuração UAZAPI

- `UAZAPI_ADMIN_TOKEN` — token de administração do servidor UAZAPI (fica **só no backend**).
- `UAZAPI_BASE_URL` — ex.: `https://free.uazapi.com` ou seu servidor dedicado.
- `API_BASE_URL` — (opcional) URL pública deste backend para registrar webhooks.
- `OPENROUTER_KEY` — chave do OpenRouter usada pelo Jev para avaliar a relação de cada produto com o tema doméstico. Necessária para importar produtos.

Sem o admin token, tudo funciona exceto conectar um número (a UI mostra um
aviso claro).

## Subindo o frontend

```bash
cd achadinhos-frontend
npm install
npm run dev                  # http://localhost:5273
```

- **`/`** → página pública (landing "Espia Doméstico"), convite para os grupos.
- **`/painel`** → ferramenta interna do time (login obrigatório). A UI de suporte
  fica sob esse caminho, separada da página pública.
- **`/painel/products`** → classifica um JSON e gerencia os produtos salvos.
- **`/painel/compose`** → seleciona os produtos salvos para uma campanha.

Em produção: `npm run build` gera `dist/index.html` (LP) e `dist/painel/index.html`
(app), com `serve.json` para as rotas SPA de `/painel`. Sirva com `npm start`
(usa o pacote `serve`).

A landing page fica em `achadinhos-frontend/landing/index.html` — edite os links
`https://chat.whatsapp.com/...` para apontar aos seus grupos.

Em desenvolvimento o Vite faz proxy de `/api` para o backend, então o cookie de
sessão (httpOnly) funciona no mesmo domínio, sem dor de cabeça de CORS.

## Importação de produtos (ingestores por marketplace)

Os produtos são importados por **ingestores** — um por marketplace:

- **Mercado Livre** (`mercadolivre`): cole o JSON exportado do hub de afiliados.
  O ingestor lê `cards[]`, usa `commissionedUrl` (link afiliado) quando existe e
  cai para `productUrl` com um aviso quando não há; captura preço atual/original,
  desconto %, parcelamento, comissão % e imagem.
- **Amazon**: planejado (a arquitetura de ingestores já suporta; basta somar a
  implementação em `src/ingestors/`).

Também há um caminho genérico (array plano com apelidos de campos) para importações
manuais. Na página de produtos, a origem é detectada automaticamente.

Antes de importar, selecione o perfil de classificação. O perfil padrão é
**Doméstico**; cada usuário pode criar, duplicar, editar e remover perfis para
outros nichos. Um perfil define o público, as instruções de relevância, os pesos
de afinidade/desconto/comissão, os tetos comerciais e os limites de A/B/C/D.
Ao importar, o backend envia apenas título e descrição do produto ao Jev
(`typesafe/jev-1.13`) pela API de avaliações do OpenRouter, junto com os critérios
do perfil escolhido. O código combina a nota de relevância
com o desconto e a comissão informados no JSON, atribui A, B, C ou D a cada
produto e mostra as categorias na revisão. A indica alta relevância e boas
condições comerciais; D indica baixa prioridade. Produtos sem desconto ou taxa
de comissão informados recebem zero nesses critérios. Se o Jev estiver
indisponível, a importação falha com uma mensagem para tentar novamente;
nenhuma categoria é inventada. O catálogo mantém uma classificação separada
para cada perfil usado no mesmo produto, inclusive após a remoção de um perfil.
Ao criar uma campanha, escolha qual classificação do nicho usar.

Cada importação aceita até 100 produtos para limitar o tempo e o custo das
avaliações pagas. As avaliações Jev são iniciadas em paralelo, até o limite
de 100 produtos por importação.

Na página de produtos, escolha quais resultados quer salvar. O catálogo pertence
ao usuário logado; salvar novamente o mesmo produto atualiza seus dados e sua
categoria do nicho escolhido sem apagar as classificações dos outros nichos.
A página de campanha lê esse catálogo para montar um disparo posterior.
No catálogo, é possível buscar entre os produtos carregados, filtrar por
categoria, editar título, preço, comissão, link e outros campos, ou remover um
produto. Campos alterados manualmente são preservados quando o mesmo produto é
importado novamente. A origem e o ID do marketplace não podem ser editados.

Produtos salvos podem pertencer a vários grupos de produtos. Na página de
produtos, crie ou renomeie grupos e adicione ou remova produtos em lote. Os
produtos já salvos antes desta atualização entram no grupo **Produtos existentes**
pela migração do banco. Na criação de campanhas, selecione um ou mais grupos
de produtos para filtrar o catálogo; o mesmo produto aparece uma vez mesmo
quando pertence a vários grupos selecionados. Esses grupos organizam o catálogo
e são diferentes dos grupos de destino do WhatsApp.

O histórico mostra cada produto por grupo da conexão WhatsApp atual. Ao criar
uma campanha, a interface informa quais combinações de produto e grupo ainda
podem ser enviadas. O backend ignora automaticamente combinações já aceitas
pela UAZAPI ou em envio, mas permite o mesmo produto nos grupos que ainda não
o receberam. Enquanto a chamada à UAZAPI está ativa, o backend renova a posse
do envio; a resolução manual só fica disponível cinco minutos após a última
renovação. Um envio sem confirmação após interrupção exige conferência no
WhatsApp antes de marcar como enviado ou liberar nova tentativa. A marca
"enviado" indica que a UAZAPI aceitou a mensagem com um ID; não é recibo de
leitura ou confirmação de entrega do WhatsApp.

Rode `npm run migrate` no backend após atualizar o código para aplicar as
migrações do catálogo e do histórico de envio por grupo no PostgreSQL local.
A migração `20260929000009` mantém o endereço do servidor na identidade da
conexão. Ela não pode ser revertida para código anterior sem ocultar o histórico
de envios e criar risco de disparos repetidos; seu rollback falha explicitamente.

No perfil padrão, a nota final pesa relevância (60%), desconto (25%, com teto
em 50%) e comissão (15%, com teto em 20%). A exige relevância de pelo menos
75/100, desconto de 15% e comissão de 10%, além de nota final de 75. B exige
relevância de pelo menos 50/100 e nota final de 55. C exige nota final de 35. Relevância abaixo
de 25/100 sempre resulta em D.

## Personalização da mensagem (templates)

Cada campanha tem um **modelo de mensagem** com `{placeholders}` e blocos
condicionais `{?campo}…{/campo}` que somem quando o campo está vazio:

Placeholders: `{title}`, `{price}`, `{original}`, `{discount}`, `{installment}`,
`{commission}`, `{coupon}`, `{url}`. O editor tem prévia ao vivo estilo WhatsApp.

## Formato do JSON de produtos

Cole um **array** de produtos. Os campos aceitam apelidos comuns e preços como
texto (`"R$ 99,90"`):

```json
[
  {
    "title": "Fone Bluetooth XYZ",
    "original_price": 199.90,
    "discounted_price": 99.90,
    "description": "Bateria de 30h, cancelamento de ruído",
    "affiliateUrl": "https://amzn.to/xxxx",
    "imageUrl": "https://.../fone.jpg",
    "coupon": "ACHOU10"
  }
]
```

Apelidos reconhecidos: `nome`/`name`/`titulo`, `de`/`original_price`,
`por`/`price`/`discounted_price`, `link`/`url`/`affiliateUrl`,
`imagem`/`image`/`imageUrl`, `cupom`/`coupon`, `descricao`/`description`.

Cada produto vira uma mensagem formatada:

```
🔥 *Fone Bluetooth XYZ*
~R$ 199,90~ ➡️ *R$ 99,90*  (50% OFF 🤑)

Bateria de 30h, cancelamento de ruído

🎟️ Cupom: *ACHOU10*

👉 https://amzn.to/xxxx
```

## Segurança de envio (anti-bloqueio)

- **Jitter**: cada mensagem espera um tempo aleatório entre `minDelaySeconds` e `maxDelaySeconds`.
- **Limite por hora** (`maxPerHour`): pausa ao atingir o teto na janela de 1h.
- **Aquecimento** (`warmupBatchSize` + `warmupPauseFactor`): pausas mais longas a cada N mensagens.
- **Embaralhar grupos** (`shuffleGroups`): não envia sempre na mesma ordem.
- Os envios usam a fila assíncrona da própria UAZAPI (`async: true`).

## API (resumo)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/v1/auth/register` | Cria usuário (1º vira ADMIN; depois só ADMIN cria) |
| POST | `/api/v1/auth/login` | Login → cookie httpOnly |
| POST | `/api/v1/auth/logout` | Logout |
| GET | `/api/v1/auth/me` | Usuário atual |
| GET | `/api/v1/connection` | Status da conexão |
| POST | `/api/v1/connection/connect` | Provisiona + inicia QR/pareamento |
| POST | `/api/v1/connection/disconnect` | Desconecta |
| GET | `/api/v1/groups?search=` | Lista grupos do número conectado |
| POST | `/api/v1/campaigns/import-offers` | Classifica um lote JSON com Jev e o perfil selecionado |
| GET/POST/PUT/DELETE | `/api/v1/classification-profiles` | Gerencia perfis de nicho do usuário |
| POST | `/api/v1/saved-products` | Salva ou atualiza produtos classificados do usuário |
| GET | `/api/v1/saved-products?limit=100&offset=0&groupId=` | Lista o catálogo pessoal e suas classificações por nicho |
| PUT | `/api/v1/saved-products/groups` | Adiciona ou remove produtos de grupos em lote |
| DELETE | `/api/v1/saved-products/:id` | Remove um produto do catálogo pessoal |
| GET/POST/PATCH/DELETE | `/api/v1/product-groups` | Gerencia grupos de produtos do usuário |
| POST | `/api/v1/campaigns/preview` | Prévia das mensagens |
| POST | `/api/v1/campaigns` | Cria campanha (rascunho ou agendada) |
| POST | `/api/v1/campaigns/:id/run` | Dispara agora |
| POST | `/api/v1/campaigns/:id/cancel` | Cancela |
| GET | `/api/v1/campaigns` | Lista campanhas |
| GET | `/api/v1/campaigns/:id` | Detalhe + progresso |
| GET | `/api/v1/campaigns/:id/logs` | Logs de envio |

## Segurança

- Senhas com bcrypt (12 rounds), comparação em tempo constante.
- JWT em cookie **httpOnly**, `sameSite=lax`, `secure` em produção.
- `helmet`, `hpp`, rate-limit global + rate-limit específico no login.
- Token de instância UAZAPI nunca é logado nem enviado ao frontend.
- Validação de entrada com Zod em todas as rotas.
