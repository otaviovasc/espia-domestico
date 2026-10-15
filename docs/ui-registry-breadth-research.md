# Pesquisa ampliada de registries e coleções de UI

Verificação: **15 de outubro de 2026**. Escopo: plataforma autenticada do Espia Doméstico, login, ferramentas de mídia, catálogo, campanhas, composição e estados associados. Páginas públicas excluídas. Este documento complementa as pesquisas de shadcn/ReUI/Dice/Base/Cult/Animate UI, Motion Primitives/Animata/React Bits/Magic UI e bibliotecas brutalistas; não repete essas fontes como novas descobertas.

Foram pesquisadas **15 coleções adicionais distintas**, com acesso HTTP às 15 páginas oficiais e inspeção de documentação, arquivos de licença ou termos oficiais. Resultado para este produto: **6 candidatas úteis**, **4 reservas condicionais**, **5 descartadas para a aplicação atual**. “Útil” significa que existe um componente específico com encaixe plausível; não significa autorização para instalar toda a biblioteca nem comprovação de integração, acessibilidade ou comportamento em runtime.

## Ordem de adoção proposta

| Ordem | Fonte | Peça específica | Onde ajudaria | Decisão |
| --- | --- | --- | --- | --- |
| 1 | Kibo UI | Image Zoom, Dropzone; Image Crop somente por ação explícita | Inspeção do produto no catálogo; seleção de mídia no estúdio e carrossel | Melhor variedade de tarefas reais, MIT e exemplos controlados. Não adicionar Kanban/Gantt sem uma necessidade real. |
| 2 | Intent UI | Multiple Select, Combo Box, Date Range Picker, Dialog | Seleção de destinos/categorias e filtros; publicação agendada; confirmação de ações | Forte referência para interação de teclado e formulários densos. React Aria e Tailwind 4; copiar apenas componentes necessários. |
| 3 | coss ui / Origin | Dialog, Sheet, Field, Empty, Table em `apps/ui/` | Diálogos, estados vazios, formulários e listas da plataforma | Bom encaixe em aplicação operacional. **Respeitar a divisão MIT/AGPL por diretório**, descrita abaixo. |
| 4 | Kokonut UI | File Upload | Seletor de arquivo com rejeição, cancelamento e progresso real no estúdio | MIT. A fonte atual aceita `onUpload` e `AbortSignal`; sem callback simula envio. Remover anéis coloridos e ilustração decorativa. |
| 5 | SmoothUI | Animated File Upload, Content Skeleton, Animated Stepper | Feedback de importação; carregamento localizado; etapas reais de uma publicação | MIT, documentação explícita de teclado e movimento reduzido. Preferir upload e estados úteis ao grande catálogo de efeitos. |
| 6 | UI Layouts | Media Modal, File Upload, Datetime Picker | Abrir imagem/vídeo de uma oferta sem perder a lista; escolher horário | MIT no repositório público. Adaptar foco, tokens, conteúdo em português e comportamento móvel; Pro é uma oferta separada. |

Essas são **opções alternativas por tarefa**, não seis sistemas para sobrepor. Primeiro reutilizar a fundação comum do projeto. Selecionar um primitive confiável para cada família de interação e preservar seu contrato ao adaptar o visual. A oferta, seu preço, sua imagem e seu destino continuam sendo o elemento principal; os registries fornecem ferramentas para trabalhar com eles.

## Evidência por fonte

### 1. Kibo UI — candidata útil

- [Documentação oficial](https://www.kibo-ui.com/docs), [repositório oficial](https://github.com/shadcnblocks/kibo), [licença MIT](https://github.com/shadcnblocks/kibo/blob/main/license.md). Código aberto, sem compra necessária para os componentes verificados. Não confundir a licença do Kibo com a oferta comercial Shadcn UI Blocks, mesmo havendo links entre os produtos.
- [Dropzone](https://www.kibo-ui.com/components/dropzone) documenta tipos, limites de tamanho/quantidade, rejeição, estado desabilitado e miniatura. Encaixe: mídia do carrossel, arquivos de importação e substituição de imagem. O callback precisa chamar o fluxo existente; validação visual não substitui validação do servidor.
- [Image Zoom](https://www.kibo-ui.com/components/image-zoom) oferece estado controlado, teclado, toque e movimento reduzido. Encaixe: conferir detalhes da imagem do produto antes de publicar. Preservar as cores da mídia e oferecer fechamento/foco restaurado.
- [Image Crop](https://www.kibo-ui.com/components/image-crop) retorna uma imagem recortada e pode comprimir/redimensionar. Encaixe apenas em edição voluntária no estúdio, nunca na troca de tema nem como transformação automática da imagem original.
- [Table](https://www.kibo-ui.com/components/table) e [Kanban](https://www.kibo-ui.com/components/kanban) existem, mas uma tabela de produtos não ganha valor por virar quadro arrastável. Preferir tabela para leitura comparativa e seleção em lote; reter paginação e filtros existentes.

### 2. Intent UI — candidata útil

- [Introdução](https://intentui.com/docs/getting-started/introduction), [fonte atual](https://github.com/irsyadadl/intentui), [MIT no branch 4.x](https://github.com/irsyadadl/intentui/blob/4.x/LICENSE). O antigo endereço `intentui/intentui` resolve para o repositório de Irsyad. Os componentes abertos são gratuitos; [Intent UI Design](https://design.intentui.com) é uma coleção separada de blocos/templates e não recebe automaticamente a mesma conclusão sobre cada ativo.
- A introdução confirma React Aria Components, TypeScript e Tailwind CSS 4. Isso reduz a distância em relação à base solicitada, mas adiciona outro conjunto de primitives se já houver Radix/Base UI no componente escolhido.
- [Multiple Select](https://intentui.com/docs/components/pickers/multiple-select) documenta busca controlada, itens selecionados como tags, erro e desabilitado. Encaixe: destinos e filtros de categoria; a lista de selecionados precisa continuar visível quando um filtro ocultar linhas do catálogo.
- [Date Range Picker](https://intentui.com/docs/components/date-and-time/date-range-picker), [Combo Box](https://intentui.com/docs/components/pickers/combo-box) e [Dialog](https://intentui.com/docs/components/overlays/dialog) são boas referências para filtros e confirmação. Localizar calendário/datas para pt-BR e manter o fuso da publicação. Não importar starter kit, autenticação ou roteamento da demonstração.

### 3. coss ui e Origin UI — candidata útil com fronteira de licença

- [Origin UI](https://originui.com/) agora apresenta coss ui. O [README oficial](https://github.com/cosscom/ui/blob/main/README.md) identifica coss como sucessor e mantém o antigo Origin como snapshot com manutenção limitada. Portanto **não contar Origin e coss como duas bibliotecas independentes ativas** nesta pesquisa.
- [Documentação coss](https://coss.com/ui/docs): Base UI com Tailwind, voltada a aplicações. [Dialog](https://coss.com/ui/docs/components/dialog), [Field](https://coss.com/ui/docs/components/field), [Empty](https://coss.com/ui/docs/components/empty) e [Table](https://coss.com/ui/docs/components/table) se encaixam em formulários, erros de consulta e listas do catálogo.
- **Licenciamento misto confirmado em [LICENSING.md](https://github.com/cosscom/ui/blob/main/LICENSING.md) e no README:** `apps/origin/` e `apps/ui/` recebem MIT; o restante usa AGPLv3 por padrão, incluindo `packages/ui/`. O [LICENSE da raiz](https://github.com/cosscom/ui/blob/main/LICENSE) sozinho não descreve a exceção MIT. Copiar um exemplo de `apps/ui/` não autoriza copiar indiscriminadamente os pacotes compartilhados.
- Para uso: registrar o caminho de cada arquivo e suas dependências; escolher componentes MIT de `apps/ui/`; verificar qualquer importação cruzada antes de trazer arquivos de `packages/`. A densidade do visual é compatível com o brief, mas os tokens verde/slate e o stack do projeto prevalecem.

### 4. Kokonut UI — candidata útil, com adaptação substancial do visual

- [Site](https://kokonutui.com/), [documentação de instalação](https://kokonutui.com/docs), [repositório](https://github.com/kokonut-labs/kokonutui), [MIT](https://github.com/kokonut-labs/kokonutui/blob/main/LICENSE). A coleção pública é aberta; há também Pro/templates, que não foram comprados ou inspecionados como arquivos licenciados nesta pesquisa.
- [File Upload](https://kokonutui.com/docs/inputs/file-upload) e sua [fonte](https://github.com/kokonut-labs/kokonutui/blob/main/components/kokonutui/file-upload.tsx) são concretamente úteis: validação de arquivo, estados de erro, progresso e cancelamento. A fonte atual prevê `onUpload(file, { onProgress, signal })`; sem `onUpload`, executa simulação por `uploadDelay`.
- Encaixe: upload de mídia e importação. Conectar ao envio real e distinguir “arquivo escolhido” de “arquivo enviado”; remover o progresso simulado. A implementação contém cores azuis e anéis multicoloridos: substituir por tokens sem alterar a cor da mídia. Não levar a ilustração animada para todo formulário.
- [Smooth Drawer](https://github.com/kokonut-labs/kokonutui/blob/main/content/docs/navigation/smooth-drawer.mdx) pode inspirar um painel de detalhe, mas não trocar o drawer mobile por animação sem provar contenção de foco, Escape e restauração.

### 5. SmoothUI — candidata útil para estados e microinterações

- [Site](https://smoothui.dev/), [fonte](https://github.com/educlopez/smoothui), [MIT](https://github.com/educlopez/smoothui/blob/main/LICENSE). O site declara a coleção aberta; a licença foi confirmada diretamente no arquivo, após o endpoint de licença da API GitHub retornar 403.
- [Animated File Upload](https://smoothui.dev/docs/components/animated-file-upload) documenta tipos/tamanho, seleção múltipla, remoção, erro anunciado, Enter/Espaço e movimento reduzido. A [documentação em fonte](https://github.com/educlopez/smoothui/blob/main/apps/docs/content/docs/components/animated-file-upload.mdx) permite conferir essas promessas sem depender do texto comercial da página inicial.
- Encaixe: importação de produtos e mídia do estúdio. É uma alternativa ao Kibo/Kokonut, não mais um upload para instalar em paralelo. `Content Skeleton` e `Animated Stepper`, expostos na navegação oficial, servem como referências de carregamento e sequência real de etapas; confirmar a fonte específica antes de copiá-los.
- Rejeitar para este produto orbs, shaders, cursores, grandes carrosséis e animação contínua em listas. Uma transição deve explicar uma mudança causada pela pessoa; consulta em background não deve deslocar a leitura.

### 6. UI Layouts — candidata útil para mídia

- [Site](https://www.ui-layouts.com/), [repositório](https://github.com/ui-layouts/uilayouts), [MIT](https://github.com/ui-layouts/uilayouts/blob/main/LICENSE). O [README](https://github.com/ui-layouts/uilayouts/blob/main/README.md) lista dependências Motion/clsx/tailwind-merge e componentes práticos. O site aponta também uma oferta Pro; a conclusão MIT refere-se ao repositório público, não a todo arquivo vendido no Pro.
- [Media Modal](https://www.ui-layouts.com/components/media-modal) aceita imagem e vídeo. Encaixe: abrir mídia na biblioteca e conferir uma oferta, preservando posição da lista. [File Upload](https://www.ui-layouts.com/components/file-upload), [Datetime Picker](https://www.ui-layouts.com/components/datetime-picker) e [Tags Input](https://www.ui-layouts.com/components/tags-input) são referências secundárias para importação, agendamento e palavras-chave.
- Não tratar uma descrição “responsive” como prova de diálogo acessível. Verificar rótulo, foco, Escape, restauração, bloqueio do scroll e vídeo pausado ao fechar. Descartar liquid glass, globos, mouse trails e efeitos WebGL para as telas operacionais.

### 7. JollyUI — reserva; bons padrões, base antiga

- [Documentação](https://www.jollyui.dev/docs), [repositório](https://github.com/jolbol1/jolly-ui), [MIT](https://github.com/jolbol1/jolly-ui/blob/main/LICENSE). Coleção aberta que adapta o estilo shadcn para React Aria.
- [Date Picker](https://www.jollyui.dev/docs/components/date-picker), [Date Range Picker](https://www.jollyui.dev/docs/components/date-range-picker), [Table](https://www.jollyui.dev/docs/components/table) e [Dialog](https://www.jollyui.dev/docs/components/dialog) ajudam a comparar semântica, navegação e seleção. Encaixe: agendamento e filtros de campanha.
- O [package.json verificado](https://github.com/jolbol1/jolly-ui/blob/main/package.json) ainda usa React 18, Tailwind 3, Next 14 e Framer Motion 11 no site. A API GitHub informou último push em 31/01/2025. Isso não prova que um componente isolado falha em React 19; significa que **não assumir compatibilidade pronta**. Intent UI é a primeira opção de React Aria nesta rodada.

### 8. Shadcn Studio — reserva com licença restritiva

- [Componentes de formulário](https://shadcnstudio.com/docs/components/form), [blocos](https://shadcnstudio.com/blocks), [repositório](https://github.com/shadcnstudio/shadcn-studio). Há exemplos gratuitos e oferta paga de blocos/templates/ativos.
- Referências úteis: formulário compacto, revisão somente leitura, formulário em diálogo/sheet, data table e stepper. Encaixe: configurações de composição e revisão de campanha. Preservar as validações e API existentes; o exemplo não concede um novo comportamento de publicação.
- **Não classificar como MIT puro.** O [LICENSE.md real](https://github.com/shadcnstudio/shadcn-studio/blob/main/LICENSE.md) contém texto MIT **mais** restrições Commons Clause sobre redistribuição/venda de componentes e produtos concorrentes. A [página oficial de licença](https://shadcnstudio.com/license) também separa recursos premium. A API GitHub classificou o arquivo como `NOASSERTION`, coerente com esse texto adicional.
- Para um app final como este, pode haver uso permitido, mas preservar licença e registrar o ativo exato; não agregar uma coleção pública de componentes copiados. Não comprar Pro por esta pesquisa.

### 9. Shadcn UI Blocks — reserva comercial, útil como catálogo amplo

- [Site oficial](https://www.shadcn-ui-blocks.com/), [form layouts](https://www.shadcn-ui-blocks.com/blocks/application/form-layouts), [data tables](https://www.shadcn-ui-blocks.com/blocks/application-pro/data-tables), [pricing](https://www.shadcn-ui-blocks.com/pricing) e [licença](https://www.shadcn-ui-blocks.com/license).
- Oferece tiers gratuitos e pagos e um catálogo agregado de registries comunitários. A coleção agregada é descoberta, **não uma nova licença universal para os componentes de terceiros**. Não somar seu número comercial de blocos ao denominador de bibliotecas efetivamente inspecionadas.
- Encaixe: comparar filtros, ações de linha, formulários em seções e seleção em tabelas do catálogo. A licença permite produtos finais, inclusive SaaS, e restringe redistribuição de blocos, bibliotecas, builders e concorrentes; não é MIT. Planos/assentos e templates têm condições distintas. Esta pesquisa não instalou nem comprou ativos pagos.

### 10. AI Elements — reserva estreita, Apache-2.0

- [Documentação oficial](https://elements.ai-sdk.dev/), [fonte](https://github.com/vercel/ai-elements), [LICENSE Apache-2.0](https://github.com/vercel/ai-elements/blob/main/LICENSE). **Não é MIT**, apesar da proximidade com o ecossistema shadcn e de resultados de busca que podem confundir pacotes homônimos.
- [Attachments](https://elements.ai-sdk.dev/components/attachments) apresenta layouts inline/list/grid, preview, remoção e estado vazio. [Audio Player](https://elements.ai-sdk.dev/components/audio-player), [Image](https://elements.ai-sdk.dev/components/image) e [Transcription](https://elements.ai-sdk.dev/components/transcription) têm possível aplicação no estúdio de mídia.
- Encaixe apenas onde o componente representa mídia já existente. Não introduzir AI SDK/chat, novas chamadas pagas, agent canvas ou elementos de raciocínio para reformar uma tela de ofertas. Preservar avisos da licença Apache ao copiar código.

### 11. Skiper UI — descartada para adoção nesta rodada

- [Site](https://skiper-ui.com/), [componentes](https://skiper-ui.com/components), [preços](https://skiper-ui.com/pricing) e [termos oficiais](https://skiper-ui.com/docs/terms-of-service) respondem; `/license` retorna 404.
- Existe conteúdo free e Pro; a página de preços oferece código-fonte premium. Os termos acessíveis descrevem direitos reservados e restringem copiar/redistribuir conteúdo do site; não foi verificada uma concessão aberta específica por componente. **Não chamar de MIT nem baixar Pro sem compra.**
- A coleção é visualmente rica em gestos e transições, mas um uso útil exigiria achar e licenciar uma peça que melhore uma tarefa real. Para upload, modal e seleção há alternativas permissivas já verificadas. Manter como referência de interação, sem copiar código nesta rodada.

### 12. 8bitcn — descartada por direção visual

- [Site](https://www.8bitcn.com/), [fonte](https://github.com/TheOrcDev/8bitcn-ui), [MIT](https://github.com/TheOrcDev/8bitcn-ui/blob/main/license.md). Gratuita e aberta; há componentes funcionais como data table, date picker, drawer e progress.
- O sistema tem identidade retro/pixel, inclusive controles e barras de jogo. Essa linguagem concorre com a legibilidade de preços, imagens e mensagens no espaço de trabalho brasileiro de ofertas. A existência de formulário/tabela não justifica importar sua tipografia, bordas e estética. Não há problema de licença identificado; a rejeição é de adequação ao brief.

### 13. Eldora UI — descartada para as telas operacionais

- [Catálogo oficial](https://www.eldoraui.site/docs/components), [fonte](https://github.com/karthikmudunuri/eldoraui), [MIT](https://github.com/karthikmudunuri/eldoraui/blob/main/LICENSE.md). O arquivo tem extensão `.md`; o caminho sem extensão retorna 404, o que não significa ausência de licença.
- [Animated List](https://www.eldoraui.site/docs/components/animated-list) funciona em loop, formando coluna, rolando e reiniciando. Esse é um contraexemplo concreto para inbox, progresso e entregas: a pessoa precisa manter posição e ler o histórico, não assistir um ticker.
- Mockups de browser/aparelhos, textos animados e backgrounds servem à apresentação de marketing. Páginas públicas estão fora do escopo. O OTP da coleção é específico de Clerk e não justifica migrar a autenticação do login.

### 14. Aceternity UI — descartada para cópia nesta rodada; referência específica registrada

- [File Upload](https://ui.aceternity.com/components/file-upload) existe como componente gratuito com `onChange(File[])`; [pricing](https://ui.aceternity.com/pricing) diferencia componentes gratuitos e acesso pago a blocos/templates. A instalação da peça usa registry próprio.
- A [licença oficial disponível](https://ui.aceternity.com/licence) concede uso em produtos finais, mas restringe redistribuição, marketplace e derivados como templates. Ela descreve Aceternity UI Pro e contempla itens baixados; os [termos](https://ui.aceternity.com/terms) trazem direitos reservados. Não foi confirmado nesta rodada um arquivo MIT oficial específico para o File Upload. Um pacote npm homônimo de terceiro não resolveria essa lacuna.
- O upload seria plausível no estúdio, mas Kibo/Kokonut/SmoothUI já cobrem validação e estados com licença permissiva verificada. Glowing borders, background beams, parallax, carrosséis de cards e hero sections não ajudam o trabalho autenticado. Por isso não copiar agora nem comprar All Access para esta mudança.

### 15. Fancy Components — descartada para adoção, útil como laboratório visual

- [Documentação](https://www.fancycomponents.dev/docs/introduction), [fonte](https://github.com/danielpetho/fancy), [MIT](https://github.com/danielpetho/fancy/blob/main/LICENSE). Coleção aberta com experimentos de texto, imagem, física e gestos.
- [Drag Elements](https://www.fancycomponents.dev/docs/components/blocks/drag-elements) permite arrastar elementos livremente e documenta momentum, elasticidade e restrições. Parece próximo do editor de composição, mas não equivale a camadas persistidas, ordenação acessível, posição numérica ou geometria de exportação. Sua adoção exigiria mais integração do que resolve neste momento.
- Gravity, cursor attraction, text scramble e imagens seguindo o cursor não dão melhor inspeção de oferta. Manter o editor atual com controles previsíveis; não alterar a saída exportada para reproduzir a animação de um demo.

## Limites e critérios de integração

Pesquisa de documentação e fonte, **sem instalar dependências, sem copiar componentes para o aplicativo, sem compras e sem abrir novas abas compartilhadas**. O Git já tinha alterações extensas de outros trabalhadores; somente este documento pertence a esta tarefa. A descoberta aqui é de fontes externas e documentos, não de símbolos do código local; não houve necessidade de consultar o grafo do projeto.

Os sites e fontes foram acessados por HTTP limitado em paralelo. A API GitHub retornou 403 em parte das consultas de licença/árvore; nesses casos foram usados arquivos raw oficiais, inclusive SmoothUI, Eldora, UI Layouts e AI Elements. Uma árvore ausente por 403 não foi tratada como prova de componente ausente. Os metadados de atividade do repositório são um indício de atualização, não um atestado de qualidade. Nenhuma alegação de acessibilidade da documentação foi convertida em verificação de leitor de tela ou teste no app.

Validação do documento: **89 links oficiais únicos**, todos com resposta HTTP 200 ao final da checagem. Intent UI Design teve um erro TLS transitório e a página de fonte do upload Kokonut respondeu 503 na primeira passagem; ambos retornaram 200 na repetição limitada. O resultado confirma acesso ao recurso, não execução correta do componente.

Antes de incorporar uma peça: registrar URL/caminho/licença do arquivo; ler suas dependências; adaptar ao contrato de tokens e pt-BR; conectar ao estado e às mutações reais; preservar tipos, preços, horários e exportação. Verificar 390px e desktop, ambos os temas, teclado, foco restaurado, erro, vazio, carregamento e movimento reduzido. Upload não pode confirmar sucesso por timer; lista dinâmica não pode perder posição; alteração visual não pode mudar a mídia publicada.
