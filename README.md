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
5. **Biblioteca de anúncios** → combina clipes, textos e música para criar vídeos verticais de divulgação.
6. **Nova campanha** → seleciona produtos do catálogo e os grupos de destino.
7. **Segurança** → define intervalo entre mensagens, limite por hora, aquecimento e embaralhamento.
8. **Enviar / Agendar** → dispara na hora ou agenda; acompanha o progresso e os logs.

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
- FFmpeg e FFprobe (para gerar vídeos na biblioteca de anúncios)
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
- **`/painel/ads`** → cria e gerencia vídeos da biblioteca de anúncios.
- **`/painel/compose`** → seleciona os produtos salvos para uma campanha.

Em produção: `npm run build` gera `dist/index.html` (LP) e `dist/painel/index.html`
(app), com `serve.json` para as rotas SPA de `/painel`. Sirva com `npm start`
(usa o pacote `serve`).

A landing page fica em `achadinhos-frontend/landing/index.html` — edite os links
`https://chat.whatsapp.com/...` para apontar aos seus grupos.

Em desenvolvimento o Vite faz proxy de `/api` para o backend, então o cookie de
sessão (httpOnly) funciona no mesmo domínio, sem dor de cabeça de CORS.

## Biblioteca de anúncios

Em `/painel/ads`, escolha **Novo vídeo** ou **Novo carrossel**.
O criador de vídeos aceita imagens JPG, PNG e WebP junto com clipes. Cada imagem
permanece na tela durante a cena, com o mesmo enquadramento, texto e transições
dos vídeos. Imagens podem ter até 20 MB e 40 megapixels.

O criador de carrosséis aceita de 2 a 20 slides com imagens e vídeos, em
1080×1350 (4:5) ou 1080×1080 (1:1). Reordene os slides pelas setas, escreva
textos opcionais em cada slide e uma legenda para Instagram. Cada imagem é
exportada como JPG; cada vídeo, como MP4 de 3 a 60 segundos com áudio original.
Vídeos curtos se repetem até completar a duração escolhida. Baixe os arquivos
numerados e selecione-os nessa ordem ao criar o carrossel no Instagram. A
publicação é manual. Projetos e cópias preservam a ordem e a legenda.

Antes de usar imagens, execute `npm run migrate` no backend para aplicar
`20261005000001-add-ad-images`. Para validar uploads, armazenamento, permissões,
renders e downloads em um banco local temporário, compile o backend e execute
`node scripts/validate-ad-media.cjs` na raiz. Acrescente `--serve` para manter a
API isolada na porta 3100 durante QA no navegador; Ctrl+C remove os dados de QA.

Para um vídeo, crie um projeto, envie as imagens e os clipes curtos e, se quiser, uma
música de fundo. Escreva as frases que aparecerão no vídeo e escolha quantas
variações gerar. Cada variação alterna os clipes e as frases. O áudio dos
clipes é removido; apenas a música enviada pelo usuário aparece na saída.
O editor permite escolher a duração, mudar clipe e frase em intervalos fixos
ou em pulsos detectados na música, selecionar um tratamento de cor e ajustar
tamanho, posição e contorno do texto. A prévia vertical mostra a composição
antes de iniciar o render. Os vídeos prontos podem ser vistos e baixados na
biblioteca; projetos podem ser salvos, duplicados e editados.

Instale `ffmpeg` e `ffprobe` no host do backend. No deploy Railway via Nixpacks,
`achadinhos-backend/nixpacks.toml` inclui FFmpeg e fontes DejaVu. A biblioteca
de anúncios aceita arquivo de música ou link HTTPS direto para um arquivo de áudio
com até 10 minutos; o usuário confirma que pode usar o áudio em anúncios. A
importação valida tipo, tamanho e endereço público e aplica os mesmos limites dos
arquivos enviados. Links de páginas do YouTube e Spotify não são arquivos de áudio
diretos; use um arquivo de áudio licenciado. Os metadados dos projetos ficam no
PostgreSQL. O backend usa `AD_STORAGE_DRIVER=local` e
`AD_MEDIA_DIR` (padrão: `./data/ad-media`) no desenvolvimento. Em produção,
configure `AD_STORAGE_DRIVER=s3` e um Railway Storage Bucket privado com estas
referências de variáveis no serviço backend:

```text
AD_S3_BUCKET=${{ad-library-media.BUCKET}}
AD_S3_ENDPOINT=${{ad-library-media.ENDPOINT}}
AD_S3_REGION=${{ad-library-media.REGION}}
AD_S3_ACCESS_KEY_ID=${{ad-library-media.ACCESS_KEY_ID}}
AD_S3_SECRET_ACCESS_KEY=${{ad-library-media.SECRET_ACCESS_KEY}}
```

O backend guarda clipes, músicas e MP4s no bucket; a API autentica o acesso
aos arquivos. O diretório local é temporário para uploads e renders. O bucket
é privado e deve permanecer assim. `AD_MAX_CLIP_MB`, `AD_MAX_MUSIC_MB` e
`AD_RENDER_CONCURRENCY` controlam limites de upload e renders simultâneos;
`AD_FONT_FILE` permite indicar outra fonte para o texto.

Os renders são trabalhos em segundo plano. Se o servidor reiniciar, acompanhe
o estado do trabalho na página e tente novamente quando necessário. O modo de
sincronização com música usa análise de pulsos de volume, portanto músicas
sem batidas claras podem produzir cortes em intervalos regulares. Confira as
variações antes de publicar e use apenas vídeos e músicas para os quais você
tem direito de uso. A [pesquisa técnica](docs/ads-research.md) registra as
fontes e as decisões de implementação.

Os emojis gráficos são derivados de [Twemoji](https://github.com/jdecked/twemoji),
por Twitter e colaboradores, sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
O pacote otimiza os SVGs para uso no render; esta atribuição deve acompanhar
o produto quando as peças forem compartilhadas.

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
indisponível, os itens afetados aparecem como falhas recuperáveis;
nenhuma categoria é inventada. Os resultados concluídos continuam disponíveis.
O catálogo mantém uma classificação separada
para cada perfil usado no mesmo produto, inclusive após a remoção de um perfil.
Ao criar uma campanha, escolha qual classificação do nicho usar.

Ao investigar uma relevância inesperadamente baixa, confira o perfil ativo e se
as instruções incluem a categoria do produto: o avaliador usa esses critérios e
pode pontuar baixo uma categoria omitida. Analise a relevância em separado dos
sinais comerciais; alta afinidade não garante faixa A se os limites de desconto
ou comissão do perfil não forem atingidos.

Cada sessão aceita até 50 arquivos JSON, com até 5.000 produtos no total e
32 MB de payload. Selecione vários arquivos de uma vez ou adicione arquivos em
seleções posteriores; a lista permite remover cada arquivo e informa erros de
leitura e JSON pelo nome. O JSON colado pode entrar como um payload separado.
Cada arquivo conserva seu formato original: é possível combinar exportações
Mercado Livre completas ou compactas com arrays genéricos na mesma sessão.

A interface e o backend validam todos os arquivos antes de iniciar avaliações
pagas. Produtos repetidos entre arquivos, identificados pela origem e ID ou pelo
mesmo link, entram uma vez na classificação; a primeira ocorrência é preservada.
A revisão informa duplicados, itens inválidos e os resultados de cada arquivo.
Nomes e posições originais acompanham resultados e retries nesta sessão.
A classificação usa lotes de quatro. O backend mantém no
máximo quatro avaliações Jev simultâneas por processo e não repete chamadas
pagas automaticamente. A interface mostra concluídos, falhas, itens ignorados
e pendentes, permite parar após o lote atual e continuar apenas os pendentes.
O botão de retry avalia somente falhas recuperáveis. O perfil escolhido fica
congelado durante a classificação. Uma resposta perdida por falha de rede tem
desfecho desconhecido e exige uma decisão manual antes de outra avaliação.

Mantenha a página aberta até salvar: a sessão de classificação fica na memória
da página. O salvamento usa lotes de 100, preserva as seleções que falharam e
mostra o progresso. A API aceita até 500 produtos por chamada de salvamento.
A revisão e o catálogo exibem 40 produtos por página. O catálogo informa quantos
produtos foram carregados e permite carregar os demais; a campanha lê todas as
páginas do catálogo. A prévia da campanha mostra quatro exemplos.

O endpoint de importação aceita `parseOnly: true` para validar e normalizar até
5.000 itens sem Jev. Para vários arquivos, envie
`payloads: [{ "name": "arquivo.json", "json": <conteúdo JSON>, "source": "mercadolivre" }]`.
O campo `source` é opcional e pertence a cada payload; `json` e `payloads` são
alternativas exclusivas. A resposta inclui `files`, `provenance`, `duplicates`
e `duplicateCount`, além dos índices globais. Arquivos com JSON ou estrutura
inválidos impedem o início da classificação e aparecem pelo nome no erro.
Para classificar, envie até quatro ofertas normalizadas com
`partialResults: true`, o `classificationProfileId` e o
`classificationProfileSnapshot` retornado em `categorization.profileSnapshot`.
`offerIndexes`, `failedOffers` e `categorization.errors` identificam os resultados
de cada item. Clientes antigos continuam podendo classificar até 100 itens por
chamada, com concorrência limitada a quatro; lotes menores evitam requests longos.
O upload de importação aceita até 32 MB. Use o JSON compacto da extensão quando
o HTML de evidência do arquivo completo exceder esse limite.

Na extensão de afiliados, informe até 20 palavras-chave ou frases de até 200
caracteres, separadas por vírgula ou quebra de linha. Escolha qualquer termo
ou todos os termos. A quantidade desejada conta produtos únicos no conjunto;
um produto que combina com várias frases entra uma vez. A interface e os
exports mostram a contagem de cada frase entre os produtos coletados.
Filtre por palavras-chave e quantidade, ou use os
controles de cada card para montar uma seleção manual. O formulário também
permite incluir um produto manualmente. Os JSONs completo e compacto da seleção
mantêm `cards[]` e funcionam no importador Mercado Livre. Links afiliados
inseridos manualmente conservam `commissionedUrlStatus: "manual_unverified"` e
geram um aviso no importador; o backend não os apresenta como verificados.

### Validação de lotes grandes

Após compilar o backend, execute `node scripts/validate-bulk-import.cjs` na raiz.
O script exige PostgreSQL local, cria um banco temporário, aplica as migrações,
valida 5.000 itens sem avaliações, testa classificação parcial e retries com um
avaliador simulado, salva os resultados e verifica catálogo, prévia e histórico.
O banco é removido ao terminar. `--live` acrescenta duas avaliações Jev pagas com
a chave local de OpenRouter. `--serve` mantém a API na porta 3100 e o banco
isolado para QA de navegador, usando o avaliador simulado após o smoke pago.
Interrompa com Ctrl+C para remover o banco. O relatório de validação fica em
[docs/bulk-import-validation.md](docs/bulk-import-validation.md).

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
- **Embaralhar produtos** (`shuffleOffers`): mistura a ordem dos produtos a cada envio.
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
