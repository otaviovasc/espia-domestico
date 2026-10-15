# Relatório de Auditoria UX / A11y / UI — Espia Doméstico (Rodada 1)

**Data:** 15 de Outubro de 2026  
**Auditor:** Agente Independente de Revisão UX/A11y (Gemini 3.8 Flash / Antigravity)  
**Escopo:** Todas as rotas do aplicativo React (`achadinhos-frontend/src`), componentes compartilhados e páginas públicas de captura (`achadinhos-frontend/landing/`).  
**Documentos de Referência:**
- `docs/ui-ux-design-brief.md` (Contrato de tokens semânticos e diretrizes)
- Claude Official `frontend-design` Skill (`SKILL.md`)
- Vercel React Best Practices & WCAG 2.2 AA / APG Guidelines

---

## 1. Sumário Executivo e Diagnóstico de Identidade Visual

### 1.1 O Diagnóstico: Eliminação dos Arquétipos Genéricos de IA
A auditoria revelou que o ecossistema do **Espia Doméstico** atualmente oscila entre dois dos três arquétipos genéricos de design gerado por IA identificados no guia oficial de `frontend-design`:
1. **O Arquétipo "Warm Cream + Terracota + Paper Grain" (Landing Principal):**  
   A landing page (`landing/index.html`) utiliza fundo creme quente (`#F7F1E8`), texto marrom café (`#49392D`), detalhes terracota (`#B96F55`) e ruído de papel simulado (`paper-grain`). Essa estética transmite a impressão de um blog artesanal ou boutique de café, conflitando diretamente com a proposta de valor do produto: um radar rápido e agressivo de promoções e cupons ocultos do Mercado Livre. Além disso, as cores secundárias (`#8D735B`) falham no contraste mínimo WCAG AA (relação ~3.2:1 em fundo claro).
2. **O Arquétipo "Dark Brutalist + Acid Yellow" (Landing Masculina):**  
   A landing masculina (`landing/masculino/index.html`) adota um fundo quase preto (`#0c0e0f`) com acentos amarelo-ácido (`#FFE600`) e títulos gigantescos em *Barlow Condensed* com clamp agressivo (`clamp(48px, 13vw, 76px)`), gerando quebras de layout em telas de smartphones estreitas (320px–360px).
3. **O Painel Interno (Template Genérico Tailwind):**  
   O painel administrativo (`achadinhos-frontend/src`) apresenta o visual padronizado de dashboards corporativos: fundo cinza claro uniforme (`#f5f5f7`), cartões brancos com sombras sutis, botões roxos (`violet-600`), ausência completa de tema escuro (`:root { color-scheme: light }`), tabelas com scroll horizontal quebrado no mobile e inputs sem associação semântica de label.

### 1.2 A Nova Identidade do Espia Doméstico
Conforme estipulado no `docs/ui-ux-design-brief.md`, o Espia Doméstico é um **ambiente operacional de trabalho para afiliados brasileiros**. A identidade visual deve ser ancorada em:
- **Superfícies verde-ardósia e tons neutros funcionais:** Em vez de roxo genérico, utilizar o verde de distribuição do WhatsApp (`accent: #27654f` / `#a4d6b7`) integrado ao sistema semântico `canvas`, `surface`, `ink`, `line`.
- **Foco absoluto na oferta e clareza de dados:** Imagens de produtos limpas, numerais tabulares legíveis para preços em Reais (`R$ xx,xx`), crachás informativos compactos e estados de entrega explícitos.
- **Remoção de elementos puramente decorativos:** Eliminar gradientes artificiais, textos motivacionais, cartões gigantescos sem ação e badges decorativas excessivas.

---

## 2. Auditoria da Fundação Arquitetural e Componentes Globais

### 2.1 Tema Claro / Escuro / Sistema e Tokens Semânticos
- **Localização:** `achadinhos-frontend/src/index.css` (L1-45), `achadinhos-frontend/src/App.tsx` (L14-45).
- **Problema Crítico:**  
  O arquivo `index.css` força rigidamente `:root { color-scheme: light; }` e estipula `background-color: #f5f5f7; color: #18181b;`. Não existem classes de tema escuro nem variáveis CSS dinâmicas baseadas no atributo `data-theme`.
- **Risco de Acessibilidade:** Usuários com fotofobia ou preferência por modo escuro no sistema operacional são forçados a visualizar telas brancas ofuscantes. Além disso, elementos do estúdio de anúncios que usam paleta escura (`#171725`) colidem visualmente com o fundo claro da casca do aplicativo.
- **Recomendação de Correção:**
  1. Adotar o contrato de tokens do `docs/ui-ux-design-brief.md` via Tailwind 4 `@theme inline`:
     - Tokens: `canvas`, `surface`, `surface-muted`, `surface-raised`, `ink`, `muted`, `subtle`, `line`, `line-strong`, `accent`, `accent-foreground`, `danger`, `success`, `warning`, `info`.
  2. Implementar provedor de tema ouvindo `localStorage.getItem('espia-theme')` (`light` | `dark` | `system`) e sincronizando `html[data-theme]` sem flashes de estilo (`FOUC`).
  3. Adicionar controle de alternância de tema no cabeçalho/menu lateral com suporte completo a navegação por teclado.

### 2.2 Componentes Primitivos (`achadinhos-frontend/src/components/ui.tsx`)
- **Evidências:**
  - `Button` (L7-27): Não possui classes de `:focus-visible`. Ao navegar via `Tab`, o botão não exibe contorno de foco, violando **WCAG 2.4.7 (Focus Visible)**. Variantes usam tons fixos de roxo (`bg-violet-600`, `hover:bg-violet-700`).
  - `Input` (L37-43): Possui anel de foco fixo `focus:ring-violet-200 focus:border-violet-500` e fundo branco `bg-white`, sem suporte a superfícies escuras.
  - `Label` (L45-47): **Grave falha a11y:** A definição `<label className="block text-xs font-medium text-zinc-700 ...">{children}</label>` descarta o atributo `htmlFor`. Leitores de tela não conseguem associar rótulos aos seus respectivos campos de entrada, violando **WCAG 1.3.1 (Info and Relationships)** e **WCAG 4.1.2 (Name, Role, Value)**.
  - `Badge` (L50-61): Cores codificadas com tons claros fixos (`bg-zinc-100 text-zinc-700`, `bg-green-50 text-green-700`). Em modo escuro, o contraste torna-se ilegível ou invertido incorretamente.
  - `Spinner` (L64-69): O elemento SVG não possui `role="status"` nem texto acessível para tecnologias assistivas (`<span className="sr-only">Carregando...</span>`), violando **WCAG 4.1.2**.
- **Recomendação de Correção:**
  - Atualizar `Label` para aceitar `htmlFor` e repassá-lo ao elemento nativo.
  - Adicionar `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]` a todos os botões e links.
  - Adicionar `role="status"` e descrição auditiva ao `Spinner`.
  - Migrar todos os estilos de variantes de botões e badges para os novos tokens semânticos.

### 2.3 Rota 404 e Navegação Global (`App.tsx`)
- **Evidências:** `achadinhos-frontend/src/App.tsx` (L86-105).
- **Problema Crítico:**  
  O roteador React captura caminhos inválidos e executa redirecionamento cego:  
  `<Route path="*" element={<Navigate to="/connection" replace />} />`
- **Impacto UX:** Se o operador clica em um link expirado ou digita uma URL incorreta, ele é jogado silenciosamente para a tela `/connection` sem nenhum feedback. Isso confunde o usuário, que não entende se a página não existe ou se foi deslogado.
- **Navegação Mobile:** O Shell do aplicativo renderiza links laterais que simplesmente quebram ou transbordam em telas menores. Falta um drawer lateral acessível (`aria-expanded`, captura de foco, tecla `Escape`) e link para pular para o conteúdo principal (`Skip to main content` — WCAG 2.4.1).
- **Recomendação de Correção:**
  - Criar componente `NotFoundPage.tsx` com código de erro amigável, explicação clara e botão para voltar ao início.
  - Adicionar link `<a href="#main-content" className="sr-only focus:not-sr-only ...">Pular para o conteúdo</a>`.
  - Implementar drawer mobile com botão hamburger acessível e fechamento com `Escape`.

---

## 3. Auditoria Detalhada das Jornadas do Usuário

### 3.1 Jornada 1: Autenticação (`LoginPage.tsx`)
- **Evidências:** `achadinhos-frontend/src/pages/LoginPage.tsx` (L30-65).
- **Barreiras e Falhas:**
  1. *Falta de associação semântica de formulário:* O campo de senha não possui `id` e o `<Label>` não repassa `htmlFor`. O leitor de tela lê apenas "edição de texto" sem informar que se trata da "Senha do painel".
  2. *Erro não anunciado:* O parágrafo `{error && <p className="text-sm text-red-600">{error}</p>}` (L50) não possui `role="alert"` nem `aria-live="polite"`. Usuários de leitores de tela não são informados quando erram a senha.
  3. *Atributo de autocompletar:* Falta `autoComplete="current-password"`, dificultando o preenchimento por gerenciadores de senhas modernos (1Password, Bitwarden, navegadores).
  4. *Estética:* Cartão flutuante genérico no centro da tela com cores duras de cinza e roxo. Deve seguir a linguagem sóbria com superfícies verde-ardósia e marca `espiadomestico`.

---

### 3.2 Jornada 2: Conexão WhatsApp e Sincronização QR (`ConnectionPage.tsx`)
- **Evidências:** `achadinhos-frontend/src/pages/ConnectionPage.tsx` (L60-245).
- **Barreiras e Falhas:**
  1. *Ação Destrutiva Sem Confirmação (L85-93):* O botão "Desconectar" chama `disconnectM.mutate()` imediatamente após o clique. Não há modal de confirmação. Se um operador com 15 grupos conectados esbarrar no botão no celular, a sessão Baileys é encerrada imediatamente, abortando campanhas em andamento!
  2. *QR Code sem feedback de expiração (L110-120):* A imagem do QR code (`<img src={status.qrCode} />`) não possui texto alternativo descritivo (`alt="QR Code para pareamento do WhatsApp"`), nem indicador visual de contagem regressiva de expiração (QR codes do WhatsApp duram cerca de 20 a 30 segundos antes de se tornarem inválidos).
  3. *Webhook inacessível para cópia (L149-166):* O endereço do webhook de mensagens é exibido dentro de uma tag `<code>` sem botão de "Copiar para área de transferência". Em telas sensíveis ao toque, selecionar textos longos de URLs dentro de blocos estreitos é propenso a erros.
  4. *Controles de rádio fora de fieldset (L186-218):* As opções "Salvar somente ofertas do catálogo" e "Salvar todas as mensagens" são renderizadas em `<label>` soltas, sem `<fieldset>` e `<legend>`, violando padrões de acessibilidade para grupos de seleção.
  5. *Polling silencioso:* O status é atualizado a cada 3 segundos, mas sem nenhum indicador visual sutil de atualização ou estado de conectividade de rede.

---

### 3.3 Jornada 3: Catálogo de Produtos, Importação em Massa e Filtros (`ProductCatalogPage.tsx`)
- **Evidências:** `achadinhos-frontend/src/pages/ProductCatalogPage.tsx` (L50-340).
- **Barreiras e Falhas:**
  1. *Bug Crítico de Seleção Estéril / Ação Fantasma (L101-118, L214-239):*  
     O estado `selectedSavedIds` (um `Set<number>`) armazena os IDs selecionados pelo usuário. Quando o usuário altera o filtro de busca (`search`), a categoria (`categoryFilter`) ou o grupo (`selectedGroupFilter`), o conjunto `selectedSavedIds` **NÃO é revalidado nem limpo**.  
     *Cenário de Desastre:* O usuário seleciona 3 produtos da categoria "Casa". Em seguida, filtra por "Eletrônicos" e clica no checkbox global para selecionar 2 produtos. Ao clicar em "Mover para o grupo X", a mutação envia todos os 5 produtos — incluindo os 3 produtos de "Casa" que estão invisíveis no filtro atual!
  2. *Tempestade de Consultas e Filtro Incompleto em Memória (L59-71):*  
     O catálogo utiliza paginação infinita (`useInfiniteQuery`), mas a busca por texto (`search`) e os filtros são aplicados apenas sobre os itens já carregados em memória (`items.filter(...)`). Se o operador possui 500 produtos cadastrados e apenas os primeiros 100 foram baixados, pesquisar por um produto na página 3 resultará em "Nenhum produto encontrado", fazendo o usuário acreditar que o item foi excluído do sistema!
  3. *Tabela com Quebra Crítica no Mobile (L256-324):*  
     A tabela tem 7 colunas com `min-w-[640px]`. Em smartphones (390px), a tela transborda horizontalmente, cortando títulos, preços e botões de ação.
  4. *Exclusão com Alvo de Toque Inadequado (L307-319):*  
     O botão de excluir produto é um ícone minúsculo com target de clique inferior a 32x32px (violando o requisito mínimo de 44x44px da WCAG 2.5.5) e invoca diálogo nativo sem feedback contextual acessível.

---

### 3.4 Jornada 4: Criação e Agendamento de Campanhas (`ComposePage.tsx`)
- **Evidências:** `achadinhos-frontend/src/pages/ComposePage.tsx` (L45-420).
- **Barreiras e Falhas:**
  1. *Tempestade Severa de Requisições no Carregamento (L59-71):*  
     Ao montar a página de composição, o código executa uma rotina para calcular quantas páginas de produtos existem e dispara requisições concorrentes em lotes de 6 para baixar **todo o catálogo de produtos** para a memória:
     ```ts
     const offsets = Array.from({ length: remainingPages }, (_, index) => (index + 1) * 100)
     for (let index = 0; index < offsets.length; index += 6) {
       pages.push(...await Promise.all(offsets.slice(index, index + 6).map((offset) => savedProductApi.list(100, offset))))
     }
     ```
     Em contas com 2.000 a 5.000 produtos, isso dispara entre 20 e 50 requisições HTTP imediatas contra a API, congelando o navegador móvel e podendo gerar erro de *Rate Limiting* (HTTP 429) no backend.
  2. *Bug de Seleção Cruzada de Grupos de Produtos (L86-98):*  
     O cálculo `includedOffers` extrai ofertas de `catalogItems` baseando-se em `selectedProductIds`, mas ignora o filtro de grupos de produtos ativos (`productGroupFilteredItems`). Se o usuário desmarcar um grupo de produtos, os itens selecionados daquele grupo continuam marcados para envio na campanha.
  3. *Campo de Agendamento Sem Fuso Horário e Sem Validação de Passado (L274-279):*  
     O campo `<Input type="datetime-local" value={scheduledAt} ... />` converte a string local para UTC via `toISOString()`, mas não exibe ao operador qual fuso horário está sendo considerado (ex: "Horário Oficial de Brasília / UTC-3"). Além disso, permite selecionar uma data ou hora no passado sem exibir erro antes do envio.
  4. *Prévia do WhatsApp com Cores Incompatíveis no Tema Escuro (L341-360):*  
     A área de prévia da mensagem simula o balão do WhatsApp com fundo verde claro `#d9fdd3` e contêiner `#e5ddd5` fixos. Em modo escuro, a prévia do balão deve ser estilizada preservando a cor real do WhatsApp Dark (`#005c4b` sobre `#0b141a`), evitando cegar o operador com um bloco branco-leite no meio de uma interface escura.
  5. *Controle de Envio em Massa Sem Confirmação de Impacto (L380-410):*  
     O botão de disparar campanha não exibe um resumo final de revisão: "Você está prestes a enviar X produtos para Y grupos (total de Z mensagens)".

---

### 3.5 Jornada 5: Monitoramento e Execução de Campanhas (`CampaignsPage.tsx`, `CampaignDetailPage.tsx`)
- **Evidências:** `achadinhos-frontend/src/pages/CampaignsPage.tsx` (L20-55), `achadinhos-frontend/src/pages/CampaignDetailPage.tsx` (L120-410).
- **Barreiras e Falhas:**
  1. *Estado Vazio Sem Ação (`CampaignsPage.tsx` L26-30):*  
     Quando não há campanhas, exibe-se apenas o texto passivo "Nenhuma campanha ainda. Crie uma em 'Nova campanha'". Não existe um botão direto com foco de ação convidando o operador a criar sua primeira campanha.
  2. *Atualização de Estado Durante a Renderização (`CampaignDetailPage.tsx` L131-140):*  
     O componente sincroniza estado local com os dados remotos chamando múltiplos setters dentro do corpo da função de renderização:
     ```ts
     if (c && seededId !== c.id) {
       setName(c.name); setOffers(c.offers); setGroups(c.groups); ...
     }
     ```
     Esse padrão gera advertências no React 19 e pode provocar loops de renderização instáveis ou perda de digitação do usuário se o hook refetch for disparado.
  3. *Diálogo Nativo Bloqueante `confirm()` (L267-275):*  
     A remoção de um produto de uma campanha em execução utiliza `window.confirm(...)`. Esse método congela a thread principal do navegador, não pode ser customizado, é hostil em dispositivos móveis e é completamente inacessível para comandos de voz e customização de tema.
  4. *Contraste Insuficiente nos Contadores de Entrega (L285-300):*  
     Os indicadores de status utilizam classes como `text-green-700`, `text-amber-700`, `text-blue-700` e `text-red-700`. Em superfícies escuras, essas cores não possuem o contraste mínimo de 4.5:1 exigido pela WCAG AA.
  5. *Layout dos Itens no Mobile (L373-395):*  
     A grade de produtos da campanha usa colunas complexas `md:grid-cols-[auto_minmax(0,1fr)_auto_auto_minmax(12rem,auto)_auto]`. No mobile, essa estrutura entra em colapso e empilha botões, badges e URLs de afiliados de maneira desorganizada, provocando sobreposição de textos.

---

### 3.6 Jornada 6: Mensagens de Grupos e Envio Manual (`GroupMessagesPage.tsx`)
- **Evidências:** `achadinhos-frontend/src/pages/GroupMessagesPage.tsx` (L100-380).
- **Barreiras e Falhas:**
  1. *Colapso da Interface no Mobile (L280-340):*  
     Em telas de desktop, a página divide-se em lista de grupos (esquerda) e conversa ativa (direita). Em telas mobile (`<1024px`), a tela se transforma em uma pilha vertical: **a lista de grupos inteira é colocada acima da conversa**! Um operador com 25 grupos cadastrados precisa rolar várias telas para baixo até encontrar a conversa e a caixa de envio de mensagens.  
     *Solução UX Padrão:* Adotar fluxo Master-Detail com transição de tela: ao clicar em um grupo no mobile, a lista se oculta e abre a tela da conversa com um botão "< Voltar aos grupos".
  2. *Modal `OfferSender` Inacessível (L214-252):*  
     O modal de escolha e envio de ofertas é implementado como um `div` simples com `fixed inset-0`:
     - Não possui `role="dialog"` nem `aria-modal="true"`.
     - Não possui `aria-labelledby` apontando para o título "Enviar oferta".
     - **Não responde à tecla Escape**: pressionar Esc não fecha o modal.
     - **Não possui Focus Trap (armadilha de foco)**: pressionar `Tab` permite que o foco do teclado saia do modal e navegue pelos botões da página de fundo!
     - Não devolve o foco ao botão que abriu o modal após o fechamento.
  3. *Sequestro de Rolagem pelo Polling Automático (L262-265):*  
     O feed de mensagens faz polling a cada 5 segundos. O hook:
     ```ts
     useEffect(() => {
       bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
     }, [messagesQuery.data, selected?.id])
     ```
     faz com que, se o operador rolar a tela para cima para ler uma mensagem antiga, a cada 5 segundos o navegador **puxa forçadamente a tela de volta para o final**, impedindo a leitura das mensagens anteriores!

---

### 3.7 Jornada 7: Estúdio Criativo e Biblioteca de Anúncios (`AdLibraryPage.tsx`, `StudioTools.tsx`)
- **Evidências:** `achadinhos-frontend/src/pages/AdLibraryPage.tsx` (L200-450).
- **Barreiras e Falhas:**
  1. *Gestão de Erros no Autosave e Risco de Perda de Dados (L205-212):*  
     O autosave é acionado após 1500ms de inatividade. Quando ocorre uma falha na rede ou na API, a barra de status entra no estado "Salvamento pausado" e bloqueia alterações posteriores. Embora proteja contra conflitos de revisão, a mensagem de erro é sutil e pode passar despercebida pelo usuário até que ele tente fechar ou atualizar a aba.
  2. *Barra Fixa Inferior que Obstrui Controles no Mobile (L422-430):*  
     A barra inferior `sticky bottom-3 z-30` com botões "Salvar projeto" e "Gerar variação" fica permanentemente sobreposta à área de edição. Em smartphones, quando o teclado virtual se abre, essa barra tampa os campos de texto ou o seletor de emojis.
  3. *Controles de Entrada Sem Nomes Acessíveis (L350-410):*  
     Vários seletores de cor (`<input type="color">`) e sliders de ajuste (`<input type="range">` para ponto de foco X/Y, tamanho de fonte e volume) não possuem `aria-label` ou `aria-valuetext` descritivo. Um leitor de tela anuncia apenas "controle deslizante, 50", sem especificar se são 50 pixels, 50% ou qual eixo está sendo calibrado.
  4. *Troca de Projeto com Diálogo Nativo `window.confirm` (L262-268):*  
     Trocar de projeto enquanto há edições pendentes invoca o alerta síncrono do navegador, gerando inconsistência visual com os modais da aplicação.

---

### 3.8 Jornada 8: Páginas Públicas de Captura e Conversão (`landing/`)

#### A. Landing Principal (`achadinhos-frontend/landing/index.html`)
- **Estética Genérica de IA:** Fundo bege/creme com textura de grão de papel (`paper-grain`), que remete a sites institucionais lentos e artesanais.
- **Falhas de Acessibilidade:**
  - Carrossel de avaliações (`#reviews-carousel` L47-65): Implementado via script personalizado, não possui controles para pausar/retomar a rotação automática nem indicador de página anunciado via `aria-live`.
  - Contraste de cor: Textos secundários em `#8D735B` sobre `#F7F1E8` resultam em contraste de **3.2:1**, reprovado pela WCAG AA (mínimo 4.5:1).
  - Ícones do WhatsApp embutidos em SVGs sem `aria-hidden="true"` explícito em todos os pontos de chamada.

#### B. Landing Masculina (`achadinhos-frontend/landing/masculino/index.html`)
- **Estética Genérica de IA:** Fundo preto absoluto (`#0c0e0f`) com acentos amarelos de alto contraste e fontes condensadas industriais, conferindo um aspecto excessivamente agressivo/pesado.
- **Problema de Overflow em Telas Estreitas:**
  - O título principal utiliza:  
    `font-size: clamp(48px, 13vw, 76px); line-height: .87;`
  - Em telas de smartphones com largura física de 360px ou 375px, palavras como "PROMOÇÕES" sofrem hifenização feia ou transbordam a margem lateral da viewport.
  - A imagem de cabeçalho (`logo-masculino.webp`) possui tamanho fixo de 58px sem compensação adequada para proporção em telas ultra-compactas.

#### C. Página de Links / Bio (`achadinhos-frontend/landing/bio/index.html`)
- **Falha de Overflow e Aceleração Gráfica:**
  - O selo flutuante de desconto utiliza transformações CSS 3D complexas:  
    `transform: perspective(450px) rotateY(-24deg) rotateX(17deg) rotateZ(8deg); animation: drift 5.5s ease-in-out infinite;`
  - Em dispositivos móveis (Android Chrome e iOS Safari), essa rotação no espaço 3D ultrapassa os limites da largura do contêiner, gerando **barra de rolagem horizontal indesejada** e fazendo a tela oscilar lateralmente quando o usuário tenta tocar nos links dos grupos!
  - As tags `<a>` que levam aos grupos do WhatsApp (`.group-link`) possuem textos secundários em tamanhos reduzidos sem definição explícita de `target="_blank"` com proteção de relatórios de segurança em todos os navegadores.

---

## 4. Matriz Priorizada de Evidências e Ações Recomendadas

| Severidade | Arquivo e Linhas | Problema Detectado | Impacto no Usuário | Recomendação Concreta de Correção |
| :--- | :--- | :--- | :--- | :--- |
| **P0 - Crítico** | `ProductCatalogPage.tsx`<br>L101-118, L214-239 | `selectedSavedIds` retém seleções de itens ocultados por filtros de busca/grupo. | Envio acidental ou reclassificação em massa de produtos errados que o usuário nem está vendo na tela. | Limpar ou filtrar ativamente `selectedSavedIds` sempre que `search`, `selectedGroupFilter` ou `categoryFilter` forem alterados. |
| **P0 - Crítico** | `ComposePage.tsx`<br>L59-71 | Laço assíncrono que baixa todas as páginas do catálogo de uma só vez via `Promise.all`. | Disparo de dezenas de requisições simultâneas; congelamento da UI e risco de bloqueio por HTTP 429. | Paginar a seleção no backend ou buscar apenas metadados compactos sob demanda por perfil ativo. |
| **P0 - Crítico** | `ConnectionPage.tsx`<br>L85-93 | Botão "Desconectar" encerra sessão sem confirmação. | Operador clica por acidente no celular e derruba o WhatsApp de todas as campanhas em andamento. | Implementar diálogo modal de confirmação acessível com aviso do impacto antes da desconexão. |
| **P0 - Crítico** | `GroupMessagesPage.tsx`<br>L280-340 | Lista de grupos e feed de mensagens empilhados verticalmente no mobile. | Operador precisa rolar 25 grupos no celular antes de conseguir ver ou responder a uma mensagem. | Criar layout Master-Detail responsivo (ocultar lista e mostrar thread com botão Voltar no mobile). |
| **P1 - Alto** | `index.css`<br>L1-45, `App.tsx` | `:root { color-scheme: light }` e cores fixas sem variáveis semânticas. | Ausência de tema escuro/sistema; usuários com sensibilidade visual sofrem fadiga extrema; FOUC. | Implementar contrato de tokens (`docs/ui-ux-design-brief.md`), `data-theme` e seletor acessível de tema. |
| **P1 - Alto** | `components/ui.tsx`<br>L45-47 | `<Label>` descarta prop `htmlFor`. | Leitores de tela não anunciam nomes dos campos ao focar inputs; reprovação total WCAG 1.3.1. | Repassar `htmlFor` e props nativas do elemento `<label>` em `ui.tsx`. |
| **P1 - Alto** | `components/ui.tsx`<br>L7-27 | Botões e links sem estilos de `:focus-visible`. | Navegação por teclado às cegas; usuário não sabe onde está o foco. | Adicionar anéis de foco visíveis de alto contraste com `focus-visible:outline-2 focus-visible:outline-offset-2`. |
| **P1 - Alto** | `GroupMessagesPage.tsx`<br>L214-252 | Modal `OfferSender` sem `role="dialog"`, sem focus trap e sem fechar com `Escape`. | Usuário de teclado ou leitor de tela fica preso ou perde o foco para elementos atrás do modal. | Usar padrão de diálogo WAI-ARIA com armadilha de foco, suporte a `Escape` e retorno de foco ao disparador. |
| **P1 - Alto** | `GroupMessagesPage.tsx`<br>L262-265 | `scrollIntoView` forçado a cada ciclo de polling de 5 segundos. | Impede o usuário de rolar para cima para ler o histórico recente de mensagens nos grupos. | Rolar para o final apenas na carga inicial ou se o usuário já estiver próximo da base da rolagem. |
| **P1 - Alto** | `App.tsx`<br>L104 | Wildcard route `*` redireciona cegamente para `/connection`. | Mascara URLs quebradas e links inválidos, gerando desorientação imediata. | Criar rota e página 404 dedicada com título claro, navegação de retorno e suporte a ambos os temas. |
| **P2 - Médio** | `landing/bio/index.html`<br>L10-25 | Elemento 3D `.percent-token` com animação flutuante gerando overflow horizontal no mobile. | Barra de rolagem horizontal irritante e quebra de usabilidade de toque em smartphones. | Adicionar `overflow-x: hidden` no elemento pai e restringir transformações 3D à largura do contêiner. |
| **P2 - Médio** | `landing/index.html`<br>L1-80 | Estética IA "warm cream" e cores `#8D735B` com baixo contraste (3.2:1). | Identidade desarticulada do produto e ilegibilidade para pessoas com visão reduzida. | Atualizar para contraste mínimo 4.5:1 e adotar estética editorial focada na velocidade dos achados. |
| **P2 - Médio** | `landing/masculino/`<br>L15-40 | Título com `clamp(48px, 13vw, 76px)` quebrando palavras em telas de 360px. | Quebras de linha irregulares e sobreposição em smartphones menores. | Calibrar o clamp tipográfico para `clamp(32px, 8vw, 64px)` com quebras de linha responsivas. |
| **P2 - Médio** | `AdLibraryPage.tsx`<br>L422-430 | Barra fixa de ações `sticky bottom-3` colide com teclado virtual móvel. | Botão de renderização cobre campos de texto ao digitar no smartphone. | Adicionar `position: relative` quando campos de edição estiverem com foco ou usar viewport visual móvel. |
| **P2 - Médio** | `CampaignDetailPage.tsx`<br>L131-140 | Chamadas a `setName`, `setOffers` etc. soltas dentro do corpo do render. | Instabilidade no React 19, potenciais loops de renderização e re-renders desnecessários. | Mover inicialização para `key={c.id}` ou efeito estabilizado com dependências corretas. |
| **P3 - Baixo** | `CampaignsPage.tsx`<br>L26-30 | Estado vazio da listagem de campanhas sem botão CTA. | Menor taxa de conversão do operador iniciante. | Incluir botão proeminente "Criar primeira campanha" apontando para `/compose`. |
| **P3 - Baixo** | `ConnectionPage.tsx`<br>L149-166 | Webhook de mensagens sem botão de cópia com um clique. | Fricção em dispositivos móveis para copiar URLs longas de configuração. | Adicionar botão de cópia com ícone de prancheta e feedback sonoro/visual "Copiado!". |

---

## 5. Diretrizes e Recomendações de Implementação

### 5.1 Arquitetura de Tokens e Sistema de Temas
1. **Estrutura no Tailwind 4 (`achadinhos-frontend/src/index.css`):**
   ```css
   @theme inline {
     --color-canvas: var(--canvas);
     --color-surface: var(--surface);
     --color-surface-muted: var(--surface-muted);
     --color-surface-raised: var(--surface-raised);
     --color-ink: var(--ink);
     --color-muted: var(--muted);
     --color-subtle: var(--subtle);
     --color-line: var(--line);
     --color-line-strong: var(--line-strong);
     --color-accent: var(--accent);
     --color-accent-foreground: var(--accent-foreground);
     --color-accent-soft: var(--accent-soft);
     --color-danger: var(--danger);
     --color-danger-soft: var(--danger-soft);
     --color-success: var(--success);
     --color-success-soft: var(--success-soft);
     --color-warning: var(--warning);
     --color-warning-soft: var(--warning-soft);
     --color-info: var(--info);
     --color-info-soft: var(--info-soft);
   }

   :root, html[data-theme="light"] {
     color-scheme: light;
     --canvas: #f3f6f4;
     --surface: #ffffff;
     --surface-muted: #edf2ee;
     --surface-raised: #ffffff;
     --ink: #183025;
     --muted: #526a5d;
     --subtle: #667e70;
     --line: #d5e1d8;
     --line-strong: #a9bfaf;
     --accent: #27654f;
     --accent-foreground: #ffffff;
     --accent-soft: #e2f0e7;
     --danger: #ac3434;
     --danger-soft: #fff0ee;
     --success: #256441;
     --success-soft: #e6f4e9;
     --warning: #83520f;
     --warning-soft: #fff4dc;
     --info: #245d79;
     --info-soft: #eaf3fa;
   }

   html[data-theme="dark"] {
     color-scheme: dark;
     --canvas: #121c18;
     --surface: #1b2821;
     --surface-muted: #24352b;
     --surface-raised: #2a3d31;
     --ink: #edf5ee;
     --muted: #b0c4b5;
     --subtle: #8ea996;
     --line: #3b5042;
     --line-strong: #607e68;
     --accent: #a4d6b7;
     --accent-foreground: #163b28;
     --accent-soft: #294d38;
     --danger: #ffb4ad;
     --danger-soft: #472a29;
     --success: #a5ddb7;
     --success-soft: #274631;
     --warning: #f0cc88;
     --warning-soft: #463b26;
     --info: #a8d5ed;
     --info-soft: #283d49;
   }
   ```
2. **Preservação Visual de Mídias e Artes:**  
   - **Nunca** inverter automaticamente as cores dos vídeos gerados, fotos de produtos ou balões reais do WhatsApp.  
   - O estágio do estúdio (`.ad-phone-stage`) e os canais de prévia de anúncios possuem iluminação própria do formato de Reels/Stories e devem permanecer protegidos de inversões arbitrárias de contraste.

### 5.2 Resolução dos Problemas de Seleção e Carregamento de Dados
1. **Seleção de Produtos no Catálogo:**
   - Adicionar efeito que limpa `selectedSavedIds` ou sincroniza com `items.map(i => i.id)` visíveis ao alternar busca/filtros.
   - Fornecer opção clara: "Selecionar os X itens visíveis nesta página" vs. "Selecionar todos os Y itens do catálogo".
2. **Carregamento Otimizado na Página de Composição (`ComposePage`):**
   - Eliminar o download maciço em lote de todo o banco de dados.  
   - Utilizar endpoint com projeção enxuta para listagem e seleção ou permitir seleção paginada pelo perfil de nicho (`activeProfileId`), realizando a consulta no backend com `limit` e `offset` controlados.

### 5.3 Diálogos Acessíveis em Vez de Métodos Nativos
- Substituir todas as chamadas de `window.confirm(...)` por um componente reutilizável `ConfirmDialog` construído com acessibilidade completa (usando `<dialog>` nativo ou `aria-modal="true"`, bloqueio de rolagem do body, armadilha de foco e escuta da tecla `Escape`).

### 5.4 Responsividade Mobile e Padrão Master-Detail
- Na página `GroupMessagesPage.tsx`:
  - Definir estado `const [activeView, setActiveView] = useState<'list' | 'thread'>('list')`.
  - Em telas menores que `lg` (`1024px`), renderizar apenas a lista de grupos se `activeView === 'list'`, e apenas a conversa se `activeView === 'thread'`.
  - Na barra superior da conversa mobile, fornecer botão acessível `<button onClick={() => setActiveView('list')}>← Grupos</button>`.

---

## 6. Conclusão e Próximos Passos
Esta auditoria fornece a base diagnóstica concreta, com números de linha e impactos de usabilidade reais, sem suposições nem alterações de código de aplicação. O relatório orienta diretamente os agentes desenvolvedores (Kiro / Sol / Gemini) na execução das tarefas de reestruturação do design system, aprimoramento da acessibilidade e eliminação dos arquétipos visuais de IA, em total conformidade com o `docs/ui-ux-design-brief.md`.

*O auditor independente aguarda a conclusão da implementação para a realização da Rodada 2 de Verificação Pós-Implementação.*
