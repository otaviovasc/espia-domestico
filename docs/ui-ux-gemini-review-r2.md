# Avaliação Técnica de UI/UX e Acessibilidade (Rodada 2)
**Projeto:** Espia Doméstico — Plataforma Autenticada  
**Data da Avaliação:** Outubro de 2026  
**Auditor:** Agente Subordinado de Revisão de UI/UX (Gemini)  
**Escopo do Diff:** Working Tree vs. Commit Base `62283c0`  
**Superfícies Inspecionadas:** Rotas autenticadas (`/painel/login`, `/painel/connection`, `/painel/compose`, `/painel/messages`, `/painel/products`, `/painel/campaigns`, `/painel/campaigns/:id`, `/painel/ads`, `/404`).  
**Exclusão Declarada:** Páginas públicas de apresentação/landing page (fora do escopo da tarefa).

---

## 1. Sumário Executivo e Veredito

A Rodada 2 da refatoração de interface e experiência da plataforma autenticada do **Espia Doméstico** demonstrou evolução substancial em relação aos problemas críticos apontados na auditoria inicial (`docs/ui-ux-gemini-audit.md`):

1. **Eliminação do Estresse de Rede no Mount do Composer:** A substituição da busca irrestrita de produtos por paginação infinita controlada (`useInfiniteQuery`, lote de 50 itens) estabilizou a carga inicial do `/compose`.
2. **Transparência de Escopo de Catálogo:** Tanto no `/compose` quanto no `/products`, a interface exibe claramente o distintivo de escopo carregado (`X de Y produtos carregados`) e esclarece ao usuário que os filtros locais operam sobre o conjunto em memória.
3. **Segurança de Ações Destrutivas com Diálogos Nativos Acessíveis:** O risco de desconexão instantânea acidental no WhatsApp foi mitigado com a introdução do `<dialog>` nativo (`ConnectionMessagesDialog.tsx`) com foco preso, backdrop acessível e restauração de foco ao cancelador.
4. **Master-Detail Responsivo em Mensagens dos Grupos:** Em telas estreitas (390px / iPhone 12 Pro), a listagem de grupos e o histórico de mensagens agora operam com transição de tela limpa e botão de retorno dedicado com alvo de toque de 44px.
5. **Autoscroll Amigável no Chat:** A rolagem automática só acompanha novas mensagens se o usuário estiver próximo ao rodapé (<80px); caso contrário, surge o badge acionável de novas mensagens, preservando a leitura.
6. **Sistema de Temas e Tokens Semânticos:** Substituição de classes hardcoded em tons violeta por variáveis CSS semânticas (`--canvas`, `--surface`, `--ink`, `--muted`, `--accent`, `--line`) com suporte ativo a Claro, Escuro e Sistema.

### Veredito Geral
**Aprovado com Apontamentos de Refinamento.** O sistema está estável, com suite automatizada 100% verde (6 testes de tema, 13 de importação, 53 de estúdio/anúncios e lint limpo). Não foram identificados bloqueadores de lançamento, porém restam inconsistências pontuais de usabilidade e acessibilidade documentalmente comprovadas abaixo.

---

## 2. Apontamentos Prioritários e Oportunidades de Correção

Abaixo estão os defeitos, inconsistências e riscos remanescentes identificados no código e validados via inspeção estática ou execução em navegador:

### [Finding 1] `window.confirm()` Síncrono no Estúdio de Anúncios e Detalhe de Campanha
* **Severidade:** Média (Inconsistência de Acessibilidade & UX)
* **Status:** Inspecionado no Código-fonte
* **Arquivos e Linhas:**
  - [`achadinhos-frontend/src/pages/AdLibraryPage.tsx:1986`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/AdLibraryPage.tsx#L1986)
  - [`achadinhos-frontend/src/pages/CampaignDetailPage.tsx:594`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/CampaignDetailPage.tsx#L594)
* **Cenário:**  
  Enquanto a `ConnectionPage` e a `ProductCatalogPage` adotaram `<dialog>` semântico acessível (`ConnectionMessagesDialog`) ou confirmações inline não-bloqueantes (`deleteConfirmId`), o recarregamento de rascunho de vídeo no `AdLibraryPage` (`if (!window.confirm('Descartar alterações não salvas...?')) return`) e a remoção de oferta em campanha no `CampaignDetailPage` continuam chamando o `window.confirm()` nativo do navegador.
* **Impacto:**
  - Bloqueia a thread principal da UI.
  - Não segue a paleta de cores nem o tema escuro ativo.
  - Em navegadores modernos, diálogos repetidos podem ser silenciados pelo usuário com "Impedir que esta página crie caixas de diálogo adicionais", quebrando a funcionalidade.
  - Usuários de teclado e leitores de tela perdem o controle da semântica de foco estruturado da aplicação.
* **Correção Recomendada:**  
  Padronizar para um diálogo semântico unificado baseado no `<dialog>` nativo ou adotar padrão inline de dois toques ("Remover? Confirmar / Cancelar"), como já implementado em `ProductCatalogPage.tsx:855`.

---

### [Finding 2] Campos de Entrada no Estúdio de Anúncios sem Associação Semântica com `<Label htmlFor="...">`
* **Severidade:** Média (Acessibilidade - WCAG 2.1 AA)
* **Status:** Inspecionado no Código-fonte
* **Arquivos e Linhas:**
  - [`achadinhos-frontend/src/pages/AdLibraryPage.tsx:1560-1595`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/AdLibraryPage.tsx#L1560-L1595)
  - [`achadinhos-frontend/src/pages/StudioTools.tsx:110-140`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/StudioTools.tsx#L110-L140)
* **Cenário:**  
  Na refatoração do `ComposePage.tsx` e `LoginPage.tsx`, todos os `<Label>` receberam atributos `htmlFor` casados com o `id` dos respectivos `<Input>`. No entanto, em controles de edição de frames e overlays no `AdLibraryPage` (ex.: inputs de desconto, temporizador e textos personalizados de cartela), alguns `<Label>` continuam apenas envolvendo texto adjacente sem associação `htmlFor` explícita ou sem `aria-label` no controle de texto.
* **Impacto:**  
  Leitores de tela não anunciam o rótulo do campo ao receber foco via Tab. Clicar no texto do rótulo não direciona o foco para a entrada correspondente.
* **Correção Recomendada:**  
  Atribuir `id` determinístico a cada input e adicionar `htmlFor` correspondente no componente `<Label>`.

---

### [Finding 3] Busca Local Depende de Pré-carregamento dos Lotes no Compose
* **Severidade:** Baixa/Média (Usabilidade em Catálogos Médios/Grandes)
* **Status:** Validado em Runtime e Código
* **Arquivos e Linhas:**
  - [`achadinhos-frontend/src/pages/ComposePage.tsx:130-155, 380-410`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/ComposePage.tsx#L130-L155)
* **Cenário:**  
  O `ComposePage` utiliza `useInfiniteQuery` com `CATALOG_BATCH_SIZE = 50`. A filtragem por texto (`catalogSearch`) e por categoria ocorre exclusivamente em memória (`useMemo`) sobre o array `loadedProducts`.
  Se o acervo do usuário contiver 300 produtos e o produto desejado estiver na posição 180 (página 4), digitar o termo na barra de busca retornará zero resultados até que o usuário clique repetidamente em "Carregar mais produtos".
* **Atenuante Implementado:**  
  A interface fornece aviso textual explícito: `"{loadedProducts.length} de {catalogTotal} produtos carregados. A busca filtra os itens carregados."`
* **Correção Recomendada:**  
  Adicionar botão contextual de atalho quando a busca em memória não encontrar itens e houver mais itens remotos: *"Buscar não encontrou nos 50 produtos carregados. [Carregar todos os produtos para busca]"* ou passar o parâmetro `search` na consulta do backend.

---

### [Finding 4] Contraste Visual das Mensagens WhatsApp no Tema Escuro
* **Severidade:** Baixa (Design e Fadiga Visual)
* **Status:** Validado em Runtime no Navegador
* **Arquivos e Linhas:**
  - [`achadinhos-frontend/src/components/WhatsAppBubble.tsx:28-45`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/components/WhatsAppBubble.tsx#L28-L45)
  - [`achadinhos-frontend/src/pages/GroupMessagesPage.tsx:380-405`](file:///home/marlos/projects/espia-domestico/achadinhos-frontend/src/pages/GroupMessagesPage.tsx#L380-L405)
* **Cenário:**  
  Quando o tema escuro (`data-theme="dark"`) está ativo, a tela inteira adota o fundo verde escuro floresta profundo (`rgb(18, 28, 24)` / `#121c18`). Todavia, o contêiner de mensagens do WhatsApp mantém a textura clássica de papel de parede claro (`bg-[#efeae2]` e bolha `#e5ddd5`), visando o realismo do WhatsApp padrão.
* **Impacto:**  
  Cria um bloco de luminância de alto contraste e intensidade em ambientes noturnos. Embora passe nos critérios de contraste de texto (WCAG AA ~4.8:1 para os textos escuros sobre o balão verde-claro), a transição de luminância da tela incomoda a visão.
* **Correção Recomendada:**  
  Disponibilizar alternância de visualização na pré-visualização (ou acatar a preferência de tema escuro do usuário também para o simulador do WhatsApp, usando os fundos nativos do WhatsApp Web Dark: fundo `#0b141a`, balão verde `#005c4b` e balão recebido `#202c33`).

---

## 3. Avaliação Detalhada por Jornada do Usuário

### Jornada 1: Autenticação, Shell e Controle de Tema
* **Observado em Runtime:**
  - `/painel/login` renderiza com título de documento apropriado (`Acessar o painel | Espia Doméstico`).
  - Formulário com controle de exibição de senha (`Eye`/`EyeOff`) devidamente anunciado via `aria-pressed` e alvos de toque `min-h-11`.
  - Controle de tema no topo direito e na barra lateral com opções "Automática (sistema)", "Clara" e "Escura". A comutação atualiza dinamicamente `document.documentElement.dataset.theme` e o `colorScheme` do CSS para `dark` sem recarregar a aplicação.
  - Skip-link funcional no topo da árvore de acessibilidade (`#main-content`).
  - Em telas móveis, o botão hambúrguer abre um `<dialog id="workspace-navigation">` com foco contido via `containDrawerFocus`.

### Jornada 2: Conexão e Gerenciamento de Instância WhatsApp
* **Observado em Runtime:**
  - `/painel/connection` apresenta status claro ("Conectado"), com indicação do número (`5511999990000`).
  - Ao acionar o botão "Desconectar", a ação perigosa é contida: surge o diálogo nativo `<dialog>` com título `Desconectar WhatsApp?`, explicando o impacto em campanhas ativas.
  - O foco vai imediatamente para o botão de fechamento/cancelamento, e pressionar Escape ou clicar em "Manter conectado" fecha a modal com foco devolvido à origem.

### Jornada 3: Catálogo de Produtos e Revisão de Importação
* **Observado em Runtime e Código:**
  - A troca de abas entre "Catálogo salvo" e "Importar e classificar" utiliza estados com atributo `hidden` nativo, preservando requisições em cache do React Query.
  - O filtro de nicho, grupo ou busca dispara `changeCatalogFilter`, limpando seleções anteriores para impedir a falha do "item fantasma" (selecionar um item filtrado, alterar o filtro e disparar ação em massa em itens que não estão mais visíveis).
  - Notificação de itens selecionados em outras páginas: `{selectedSavedIds.size} selecionado(s), incluindo {selectedOnOtherPages} em outras páginas deste filtro`.
  - Edição manual de produtos em formulário inline expõe aviso de override e mantém rastreabilidade por nicho selecionado.

### Jornada 4: Criação de Campanha (Compose Page)
* **Observado em Runtime:**
  - O cabeçalho resume instantaneamente os itens: links rápidos ancorados para `#compose-products`, `#compose-groups` e `#compose-send`.
  - A troca de nicho exibe alerta textual de que ofertas selecionadas fora daquele nicho serão descartadas.
  - Lotes de 50 produtos sob demanda impedem que dezenas de imagens sobrecarreguem a rede.
  - O editor de modelo do WhatsApp reflete dinamicamente a mensagem com quebra de linha real, botões de ação e aviso caso o produto selecionado esteja sem preço promocional ou sem comissão afiliada.
  - Se a criação da campanha no banco for concluída mas o disparo falhar, o estado da página salva o `createdCampaignId` e oferece link direto para a campanha em vez de incentivar envios duplicados.

### Jornada 5: Mensagens dos Grupos e Responsividade Mobile
* **Observado em Runtime:**
  - Testado no viewport 390x844 (iPhone 12 Pro): em telas móveis, a lista de grupos ocupa 100% da largura. Ao tocar no grupo ("Casa prática · ofertas"), a lista se oculta e o painel de mensagens assume o foco, exibindo o botão de retorno "Voltar para os grupos" com target de toque `44x44px`.
  - Ao acionar "Voltar para os grupos", o cabeçalho "Seus grupos" é restaurado sem perda de estado da conversa.
  - O rodapé de envio móvel flexiona a entrada de texto e os botões de disparo de forma a garantir alvos confortáveis de toque.
  - O histórico de conversas mantém ancoragem no rodapé apenas se o scroll estiver próximo ao final (<80px), prevenindo pulos bruscos durante a leitura de mensagens antigas.

### Jornada 6: Roteamento e Páginas Não Encontradas
* **Observado em Runtime e Código:**
  - Removido o redirect cego `* -> /connection`.
  - Rotas desconhecidas acionam `NotFoundPage`, que renderiza dentro do `WorkspaceShell` caso o usuário esteja autenticado (preservando o menu lateral e a identidade) ou em tela cheia se for visitante deslogado.

---

## 4. Matriz de Cobertura: Verificado em Runtime vs. Inferência Estática

| Superfície / Fluxo | Método de Verificação | Status de Cobertura | Observações |
|---|---|---|---|
| `/painel/login` (Auth Flow) | Runtime (Browser Live 1280px & Mobile) | **Verificado** | Submissão de credenciais sintéticas QA, alternância de senha, foco em erro. |
| Alternância de Temas (Claro/Escuro/Sistema) | Runtime (Browser Live - Avaliação DOM) | **Verificado** | Variáveis CSS `--canvas` (`rgb(18, 28, 24)`), tokens semânticos e tags HTML validados. |
| `/painel/connection` (Desconexão WhatsApp) | Runtime (Browser Live - Interação Real) | **Verificado** | Diálogo `<dialog>` nativo aberto, foco contido, cancelamento preservado sem logout. |
| `/painel/compose` (Paginação e Escopo) | Runtime (Browser Live) | **Verificado** | Lotes de 50, badge de contagem de itens carregados, persistência de seleção por categoria. |
| `/painel/messages` (Mobile Master-Detail) | Runtime (Browser Live 390px iPhone 12 Pro) | **Verificado** | Alternância lista -> chat -> retorno via botão; alvos de toque >=44px validados. |
| `/painel/messages` (Chat Autoscroll Lock) | Testes Unitários + Código-fonte | **Verificado** | Lógica de `nearBottomRef` (<80px) e botão flutuante de novas mensagens conferidos no código. |
| `/painel/products` (Seleção e Filtros) | Código-fonte + Testes Unitários | **Verificado** | `selectedSavedIds` limpo em `changeCatalogFilter`; contagem de outras páginas testada. |
| `/painel/campaigns` & `/campaigns/:id` | Código-fonte + Testes Unitários | **Inferência Estática** | Tratamento de 404, confirmação de pausa/cancelamento e descrições de status auditadas. |
| `/painel/ads` (Estúdio de Anúncios) | Testes Unitários (`npm run test:*`) + Código | **Verificado via Testes + Código** | 53 testes passando (preview, creative, studio); identificada pendência de `window.confirm`. |
| Rotas Públicas / Landing Page | Exclusão Deliberada | **Excluído** | Conforme diretriz explícita da tarefa, superfícies públicas foram mantidas intocadas. |

---

## 5. Recomendações Priorizadas para Próximos Passos

1. **Substituir remanescentes de `window.confirm()`:**
   - Adotar componente modal acessível padronizado nas ações de descarte do `AdLibraryPage` e exclusão no `CampaignDetailPage`.
2. **Associar `<Label htmlFor="...">` restantes no `AdLibraryPage`:**
   - Fechar a conformidade de acessibilidade para 100% dos formulários da aplicação.
3. **Melhoria da Busca Parcial no Compose:**
   - Oferecer gatilho para buscar na base inteira quando o termo pesquisado não for encontrado na primeira página carregada.
4. **Modo Noturno nos Balões do Simulador de WhatsApp:**
   - Introduzir variante escura para a pré-visualização de mensagens quando o tema escuro estiver selecionado.
