# Neobrutalismo arredondado para o Espia

Pesquisa em fontes primárias em 15/10/2026. Escopo: interface autenticada e login; páginas públicas e cores dos arquivos de mídia estão fora desta proposta. Este documento não instala bibliotecas nem altera a aplicação. As paletas abaixo são alternativas: a aplicação deve escolher **uma** e continuar usando o contrato semântico único de `ui-ux-design-brief.md`.

## Recomendação

Adotar **neobrutalismo arredondado de baixa intensidade**, com a paleta Azul oferta. Usar azul como marca/ação e manter verde exclusivamente associado a sucesso, conexão e canal WhatsApp. A personalidade vem da moldura da oferta selecionada e de um botão principal com sombra sólida curta. Formulários, tabelas, navegação e ferramentas continuam calmos, compactos e legíveis.

Isso muda mais que a cor: controles ficam claramente reconhecíveis, a oferta ganha presença e a seleção deixa de depender de um verde discreto. O produto continua sendo uma bancada de publicação, com imagem, preço, destino e estado de entrega à vista. Não precisa de estrelas, rabiscos, adesivos, títulos gigantes, gradientes ou blocos de cores diferentes para cada módulo.

Alternativa conservadora: Verde folha, se preservar associação com distribuição for mais importante que diferenciar marca e estado. Ameixa editorial funciona como direção de marca mais própria, mas exigiria mais cuidado com imagens de produto muito saturadas. Não combinar os três acentos.

## Bibliotecas e referências verificadas

Os links de código com SHA fixam o material realmente consultado. URLs de registry são móveis e devem ser revistas antes de incorporar código.

| Referência | Evidência concreta | Aproveitar | Adaptar ou evitar |
| --- | --- | --- | --- |
| [Neobrutalism components](https://www.neobrutalism.dev) | O site declara React, Tailwind v4, shadcn/ui e Base UI. [Button real](https://neobrutalism.dev/r/button.json), [Card real](https://neobrutalism.dev/r/card.json), [estilo blue real](https://neobrutalism.dev/r/styling/blue.json). [Fonte](https://github.com/ekmas/neobrutalism-components/tree/3306a802724874a85f93079702b2795370a279d4). | Bordas explícitas, sombras sem desfoque, botão `noShadow`, variantes neutral/ghost. | O estilo blue consultado tem raio de **5px**, sombra **4px 4px** e não fornece bloco dark; não é uma solução pronta para o tema duplo do Espia. O botão move 4px no hover e usa ring preto; adaptar movimento e foco ao tema escuro. |
| [Brut/UI](https://www.brut-ui.site) | O site oferece sabores Paper/Signal/Sky, forças Soft/Solid/Loud e raios Sharp/Cut/Chunky. [Button real](https://www.brut-ui.site/r/button.json), [CSS de origem](https://github.com/devkit-labs/brut-ui/blob/5b6203c059e05bb3fe7b89e26e5a5ea88ef88176/registry/brutalist/styles/brutalist.css). | Melhor referência estrutural: força e arredondamento são eixos independentes; `.brut-quiet` e `.brut-item` não recebem sombra. `chunky` é **0.875rem**, e `soft` usa borda de **1px**, sombra de controle de **2px** e de painel de **4px**. | Não importar seu CSS global: redefine `body`, seleção, bordas e scroll. Não adotar caixa alta nos chips nem sombras em todos os campos. Tamanhos `xs`/`sm` do botão podem ser pequenos demais para toque. |
| [neobrutal-ui](https://neobrutal-ui.andongmin.com) | Site demonstra formulário funcional de exemplo e declara React/Base UI/Tailwind v4, temas claro/escuro. [Button real](https://neobrutal-ui.andongmin.com/r/button.json), [fonte](https://github.com/andongmin94/neobrutal-ui/tree/b4da2463fe710a77bf464c65125a1a7f40424722). | Resposta tátil em estágios e `motion-reduce:transition-none`; classes de transição limitadas às propriedades usadas. Boa referência de conjunto coeso, além de componentes isolados. | Demonstração visual não prova navegação, foco ou contraste do Espia. Movimento ainda precisa ser eliminado para a preferência de movimento reduzido; apenas remover a transição não elimina o deslocamento. |
| [BoldKit](https://boldkit.dev) | [Button real](https://boldkit.dev/r/button.json), [fonte](https://github.com/ANIBIT14/boldkit/tree/2f289564ae075b453fb09e41b87c4b9cc90ba295). Registry devolve dependências `radix-ui` e `class-variance-authority`. | Referência de botão com altura de 44px e variantes sem sombra. | Base visual mais ruidosa: borda de 3px, caixa alta, tracking, sombra de 4px e opções pulse/bounce/wiggle. Não usar esses padrões em operação diária. |

As quatro coleções estão no [catálogo oficial de registries do shadcn](https://ui.shadcn.com/r/registries.json): `@neobrutalism`, `@brut-ui`, `@neobrutal-ui`, `@boldkit`. O catálogo também lista `@retroui` em `https://retroui.dev/r/{name}.json`; o site e o JSON de botão retornaram **HTTP 403** nesta pesquisa. Portanto, RetroUI é uma opção encontrada, mas seu código/licença/adequação não foram validados aqui. Não confundir repositórios homônimos encontrados no GitHub com a origem desse domínio.

O registry distribui fonte para adaptação; não é preciso instalar uma biblioteca completa para obter esse visual. A [documentação do shadcn registry](https://ui.shadcn.com/docs/registry) explica o mecanismo. Para o Espia, preservar a API atual de Button/Card/Input e adaptar o desenho é o caminho mais econômico. Dialogs e menus complexos podem justificar primitivas acessíveis em uma mudança separada de comportamento.

### Licenças verificadas

Todos os quatro repositórios acima têm licença MIT no conteúdo consultado. MIT permite uso comercial e modificação, exigindo preservar aviso de copyright e licença nas cópias ou partes substanciais. Se houver cópia efetiva, registrar a origem e o aviso em um arquivo de licenças de terceiros; inspiração visual não deve ser apresentada como componente copiado.

| Origem | Licença primária fixada | Copyright lido |
| --- | --- | --- |
| Neobrutalism components | [LICENSE](https://github.com/ekmas/neobrutalism-components/blob/3306a802724874a85f93079702b2795370a279d4/LICENSE) | 2023 Samuel Breznjak |
| Brut/UI | [LICENSE](https://github.com/devkit-labs/brut-ui/blob/5b6203c059e05bb3fe7b89e26e5a5ea88ef88176/LICENSE) | 2026 DevKit Labs |
| neobrutal-ui | [LICENSE](https://github.com/andongmin94/neobrutal-ui/blob/b4da2463fe710a77bf464c65125a1a7f40424722/LICENSE) | 2023 Samuel Breznjak; preservar o aviso herdado |
| BoldKit | [LICENSE](https://github.com/ANIBIT14/boldkit/blob/2f289564ae075b453fb09e41b87c4b9cc90ba295/LICENSE) | 2025 BoldKit |

[Gumroad](https://gumroad.com) oferece uma referência real de comércio com linguagem gráfica marcante e produto como conteúdo principal. Seu [repositório](https://github.com/antiwork/gumroad/tree/0cffdae98ff4cdb6ad239a3dc9fa09e06793d47d) também usa [MIT](https://github.com/antiwork/gumroad/blob/0cffdae98ff4cdb6ad239a3dc9fa09e06793d47d/LICENSE.md), copyright 2024 Gumroad, Inc. Serve como referência de hierarquia comercial; esta pesquisa não auditou sua interface autenticada nem recomenda copiar sua marca, imagens, composição de landing page ou infraestrutura.

### Adequação a React 19 / Tailwind 4

O Espia declara React `^19.2.0`, Tailwind `^4.1.17`, Vite e React Router em `achadinhos-frontend/package.json`. O [package.json do Neobrutalism components](https://github.com/ekmas/neobrutalism-components/blob/3306a802724874a85f93079702b2795370a279d4/package.json) usa React 19 e Tailwind 4. O [package.json do Brut/UI](https://github.com/devkit-labs/brut-ui/blob/5b6203c059e05bb3fe7b89e26e5a5ea88ef88176/package.json) também usa React 19 e Tailwind 4. Seus sites são Next.js, mas os botões consultados são componentes React e classes CSS, não exigem migrar o Espia para Next.js.

Isso demonstra afinidade de stack, não integração testada. Os itens consultados pressupõem `cn`, aliases `@/`, tokens próprios, CVA e, em vários casos, Base UI. Mapear tokens para os semânticos do Espia, conferir todos os imports e estados e revisar diffs antes de adotar qualquer trecho. Não executar um `shadcn add` que sobrescreva o tema ou componentes atuais como etapa meramente estética.

## Três paletas completas de marca

Os valores abaixo são sRGB opacos. `line` é divisória decorativa; **não** basta para identificar um campo ou controle. Usar `line-strong` nos contornos de controles que dependem dessa borda para serem percebidos. `accent-soft` acompanha texto `ink`/`muted` ou um estado ativo com `accent`; não usar texto branco sobre ele.

### A. Azul oferta — recomendada

Azul mineral mais incisivo no claro, azul pervinca mais suave no escuro. Os neutros têm só o suficiente de azul para se relacionarem com os controles. Verde de estado e a cor real da mídia WhatsApp deixam de competir com a identidade.

| Token | Claro | Escuro |
| --- | --- | --- |
| `canvas` | `#EDF2FA` | `#121926` |
| `surface` / `surface-raised` | `#FFFFFF` | `#1B2638` |
| `surface-muted` | `#E3EAF5` | `#26354B` |
| `ink` | `#18243C` | `#EFF4FF` |
| `muted` / `subtle` | `#4D5D77` | `#BAC7DE` |
| `line` | `#A9B7CB` | `#526684` |
| `line-strong` | `#18243C` | `#B4C7E7` |
| `accent` | `#3153C7` | `#AFC4FF` |
| `accent-foreground` | `#FFFFFF` | `#182B64` |
| `accent-soft` | `#DDE6FF` | `#293F70` |

### B. Verde folha — evolução do atual

Preserva a associação com distribuição e reduz o custo de transição. O ganho viria principalmente da estrutura, escala e contraste, já que a mudança de cor é moderada. Exige distinguir ação principal de sucesso por rótulo, ícone e posição.

| Token | Claro | Escuro |
| --- | --- | --- |
| `canvas` | `#EDF3EE` | `#13201A` |
| `surface` / `surface-raised` | `#FFFFFF` | `#1D2E25` |
| `surface-muted` | `#E1EBE3` | `#2A3F32` |
| `ink` | `#192D24` | `#EEF6EF` |
| `muted` / `subtle` | `#4B6255` | `#B8CDBD` |
| `line` | `#A4B8AA` | `#577461` |
| `line-strong` | `#192D24` | `#A7C8B0` |
| `accent` | `#275C47` | `#A7D8B7` |
| `accent-foreground` | `#FFFFFF` | `#153D29` |
| `accent-soft` | `#D6EBDE` | `#2D503B` |

### C. Ameixa editorial — alternativa de maior personalidade

Roxo ameixa com neutros lilases discretos. Ajuda a separar ferramenta e canal sem adotar o preto com verde ácido. Usar a mesma geometria das outras opções; não acrescentar rosa, amarelo e ciano como acentos simultâneos.

| Token | Claro | Escuro |
| --- | --- | --- |
| `canvas` | `#F2EFF8` | `#1B1724` |
| `surface` / `surface-raised` | `#FFFFFF` | `#2A2237` |
| `surface-muted` | `#E9E2F1` | `#3B2E49` |
| `ink` | `#2A203A` | `#F7EFFF` |
| `muted` / `subtle` | `#665572` | `#CBB9D9` |
| `line` | `#BDAEC9` | `#786489` |
| `line-strong` | `#2A203A` | `#CFB4E3` |
| `accent` | `#73489A` | `#D9B4F1` |
| `accent-foreground` | `#FFFFFF` | `#3B1F52` |
| `accent-soft` | `#EBDEF7` | `#503263` |

### Contraste calculado

Fórmula de [luminância relativa do WCAG](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance): converter canais sRGB normalizados; se `c <= 0.04045`, `cLinear = c / 12.92`, senão `((c + 0.055) / 1.055)^2.4`; `L = 0.2126R + 0.7152G + 0.0722B`. Razão `(LmaisClara + 0.05) / (LmaisEscura + 0.05)`. Valores arredondados só para apresentação.

[WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) pede 4.5:1 para texto normal; [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) pede 3:1 para informação visual necessária de controles/estados. Não aplicar opacidade aos textos para criar outra cor sem recalcular.

| Paleta / tema | `ink` / surface | `muted` / surface | `muted` / surface-muted | texto do botão / accent | accent / surface | line-strong / surface | `muted` / accent-soft |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Azul claro | 15.48 | 6.67 | 5.51 | 6.58 | 6.58 | 15.48 | 5.35 |
| Azul escuro | 13.80 | 8.92 | 7.27 | 7.75 | 8.81 | 8.88 | 6.04 |
| Verde claro | 14.56 | 6.61 | 5.41 | 7.75 | 7.75 | 14.56 | 5.29 |
| Verde escuro | 12.97 | 8.51 | 6.74 | 7.59 | 8.95 | 7.85 | 5.39 |
| Ameixa claro | 15.37 | 6.76 | 5.35 | 6.73 | 6.73 | 15.37 | 5.25 |
| Ameixa escuro | 13.56 | 8.30 | 6.86 | 7.81 | 8.50 | 8.17 | 5.81 |

As seis combinações `line` / surface variam de **2.03 a 2.88**, abaixo de 3:1. Por isso, `border-line` continua útil para linhas de tabela e separação redundante, e controles usam `line-strong`. O contorno de foco pode usar `accent`, com espaço de 3px para que seja comparado com a superfície, não diretamente com o preenchimento do botão. Testar também sobre canvas, menus, alerts e qualquer mídia adjacente.

### Estados semânticos comuns às três alternativas

Manter os pares já definidos no brief; são estados, não uma segunda paleta de marca. Um texto e ícone descrevem o estado mesmo sem cor. Não pintar um card inteiro de verde porque a conexão está ativa.

| Estado | Texto claro / fundo claro | Razão | Texto escuro / fundo escuro | Razão |
| --- | --- | ---: | --- | ---: |
| Sucesso | `#256441` / `#E6F4E9` | 6.21 | `#A5DDB7` / `#274631` | 6.79 |
| Atenção | `#83520F` / `#FFF4DC` | 6.05 | `#F0CC88` / `#463B26` | 7.16 |
| Erro | `#AC3434` / `#FFF0EE` | 5.75 | `#FFB4AD` / `#472A29` | 7.59 |
| Informação | `#245D79` / `#EAF3FA` | 6.41 | `#A8D5ED` / `#283D49` | 7.23 |

## Escala de forma e peso

| Elemento | Raio | Borda | Sombra sólida | Uso |
| --- | ---: | ---: | --- | --- |
| Checkbox | 4px | 2px strong | nenhuma | Área de toque de 44px com label clicável |
| Campo, busca, select | 12px | 2px strong | nenhuma | Foco visível e erro textual; altura de 40px desktop/44px toque |
| Botão primário | 12px | 2px strong | `2px 2px 0` | Uma ação dominante por grupo |
| Botão secundário | 12px | 2px strong | nenhuma | Superfície neutra, texto ink |
| Ghost / linha de navegação | 8px | sem borda ou transparente | nenhuma | Estado atual com fundo accent-soft + marcador/`aria-current` |
| Oferta selecionada / prévia principal | 16px | 2px strong | `4px 4px 0` | Assinatura visual; não todas as ofertas ao mesmo tempo |
| Painel comum / tabela | 12px | 1px line | nenhuma | Preservar alinhamento de linhas e densidade |
| Dialog / popover | 16px / 12px | 2px strong | `4px 4px 0` / `2px 2px 0` | Elevação justificada por sobreposição |

`strong` significa `line-strong`, não preto puro em todos os temas. No escuro, sombra pode continuar `#080D16` para Azul, `#080F0B` para Verde ou `#100C16` para Ameixa; é decorativa e não deve ser o único delimitador. A borda clara assegura o contorno. Não simular sombras escuras com linhas brancas deslocadas: isso cria um efeito de adesivo muito intenso.

Manter ritmo 4/8/12/16/24px. Manrope 650–700 em títulos de 24–28px; IBM Plex Sans 400–500 em corpo, dados e formulários de 14–16px; 600 nos controles. Preços em 22–28px com numerais tabulares e `R$ 129,90` inteiro, sem fracionar centavos em tamanho minúsculo. Não acrescentar uma terceira família ou caixa alta por estilo.

No pressionamento, botão primário pode deslocar 1px e reduzir sombra; hover apenas altera o fundo, sem mover todos os controles. Transições de 100–140ms somente nas propriedades necessárias. Com `prefers-reduced-motion: reduce`, remover deslocamento e transição e preservar resposta por cor/borda. Um item selecionado não deve saltar a posição da lista.

## Esboço do componente principal

O risco visual é uma **moldura de prova da oferta**, familiar a quem revisa uma publicação: produto e preço em primeiro plano, mensagem legível ao lado, destino e estados em uma faixa factual abaixo. A sombra curta identifica a oferta em revisão. O restante da página usa linhas e alinhamentos.

```text
Catálogo                         [Buscar produto]  [Filtros]
128 produtos                     3 selecionados    [Criar publicação]

┌─────────────────────────────┬────────────────────────────────┐
│ Imagem real do produto       │ Fone Bluetooth                 │
│ sobre sua própria superfície│ R$ 129,90                      │
│                             │ Cupom: CASA10                  │
│                             │ Mensagem editável e legível    │
├─────────────────────────────┴────────────────────────────────┤
│ Destino: Ofertas da casa   Agendada para 14:30  [Revisar oferta]│
└──────────────────────────────────────────────────────────────┘
  sombra sólida de 4px somente na oferta selecionada

Demais resultados: imagem pequena, nome, preço, origem, seleção.
Sem card de estatística ocupando o lugar dos produtos.
```

No mobile, empilhar imagem e conteúdo; destino e horário quebram em linhas legíveis, com ação de largura adequada. Não esconder ação sob hover. Em campanhas, reservar moldura para a publicação aberta; filas e entregas continuam listas. No estúdio, a mídia ocupa o palco e ferramentas avançadas ficam agrupadas ao lado/abaixo. Na conexão, mostrar dispositivo e ação; não transformar QR em bloco colorido da marca.

## Acessibilidade e limites do tema

Primitivas não certificam a tela. A [documentação de acessibilidade do Base UI](https://base-ui.com/react/overview/accessibility) distingue o que a biblioteca oferece — teclado, atributos e foco em muitos componentes — das responsabilidades da aplicação: foco visível, contraste e nomes acessíveis. Não copiar estilos sem conferir rótulos, estados loading/disabled, mensagens de erro e ordem de foco.

Arte exportada, criativos, imagem de produto, QR code e bolha de mensagem que representam o conteúdo enviado mantêm seus próprios valores. A borda do painel e os controles respondem ao tema; o bitmap e a composição exportada não. Não usar filtro invert, overlays globais nem substituir verde real da mensagem por accent. Um fundo branco de imagem pode continuar branco no dark, com moldura neutra e sem flash visual excessivo.

Após uma implementação, verificar 390px e desktop, dois temas, teclado, foco em botões coloridos, popovers, dialogs e estados de falha. Recalcular sobreposições e cores com alpha, e inspecionar bordas necessárias que usem `line`. Conferir que imagem, preço, destino e ação continuem visíveis e que exportações tenham os mesmos pixels/configuração antes e depois de trocar tema. Esta pesquisa validou fontes e pares de cor, não executou essa prova na aplicação.

## Decisão proposta e sequência curta

1. Escolher Azul oferta como único contrato de marca; manter Verde folha apenas como alternativa caso a direção verde seja preferida.
2. Aplicar primeiro a Button/Input/foco e à oferta selecionada; revisar catálogo, compose e um dialog em ambos os temas antes de propagar.
3. Ajustar shell por último para acompanhar os componentes; evitar colorir navegação e toda a área de conteúdo com accent.
4. Preservar fontes, conteúdo, comportamento e APIs atuais. Nenhuma dependência nova é necessária para bordas, raios, sombras e paleta.

Critério de corte: se um elemento continuar igualmente compreensível e hierárquico ao retirar a sombra, e não for a ação/objeto em revisão, retirar a sombra. A força do conjunto depende dessa diferença de peso.
