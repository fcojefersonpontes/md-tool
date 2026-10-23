---
perfil: abnt
---


# Perfil ABNT para documento formal: especificação de exportação (PDF e RTF)

Especificação de estilo para converter Markdown em PDF e RTF seguindo as regras gerais de apresentação da ABNT (NBR 14724:2024, NBR 6024:2012, NBR 10520:2023), sem a estrutura de trabalho acadêmico (capa, folha de rosto, resumo etc.).

Princípio de implementação: todos os valores vivem num único arquivo de tokens (seção 1); os renderizadores de PDF e RTF apenas os traduzem. Assim os dois formatos nunca divergem.

## 1. Tokens de estilo (fonte única)

```yaml
pagina:
  tamanho: A4              # 210 × 297 mm
  margem_superior: 3cm
  margem_esquerda: 3cm
  margem_inferior: 2cm
  margem_direita: 2cm
  frente_verso: false      # se true, no verso inverte esquerda/direita

fonte:
  familia: "Times New Roman"   # alternativa: "Arial" (ABNT não fixa família)
  corpo: 12pt
  menor: 10pt                  # citações longas, notas, legendas, fontes, paginação
  monoespacada: "Courier New"
  cor: "#000000"

espacamento:
  corpo: 1.5                   # entrelinhas
  simples: 1.0
  paragrafo_antes: 0
  paragrafo_depois: 0
  titulo_antes: 1linha_1.5     # um espaço de 1,5 antes e depois de títulos
  titulo_depois: 1linha_1.5

paragrafo:
  alinhamento: justificado
  recuo_primeira_linha: 1.25cm
  hifenizacao: true
  idioma: pt-BR

citacao_longa:
  recuo_esquerdo: 4cm
  fonte: menor
  entrelinhas: simples
  aspas: false

nota_rodape:
  fonte: menor
  entrelinhas: simples
  filete_largura: 5cm
  numeracao: arabica_continua

paginacao:
  posicao: superior_direita
  distancia_borda_superior: 2cm
  distancia_borda_direita: 2cm
  fonte: menor
  primeira_pagina_visivel: true   # configurável; ver seção 12

numeracao_secoes: true            # numeração progressiva automática (NBR 6024)
```

## 2. Página

| Regra | Valor | CSS (PDF) | RTF |
| --- | --- | --- | --- |
| Formato | A4 | `@page { size: A4; }` | `\paperw11906\paperh16838` |
| Margens anverso | sup. 3, esq. 3, inf. 2, dir. 2 cm | `margin: 3cm 2cm 2cm 3cm;` | `\margt1701\margl1701\margb1134\margr1134` |
| Frente e verso | Espelha esquerda/direita | `@page :left { margin-left: 2cm; margin-right: 3cm; }` | `\margmirror` |
| Cor do texto | Preto (cores só em ilustrações) | `color: #000;` | tabela de cores com preto como padrão |

Conversão RTF: 1 cm = 567 twips; tamanhos de fonte em meios-pontos (12 pt = `\fs24`, 10 pt = `\fs20`).

## 3. Tipografia e parágrafo

| Elemento | Regra | CSS | RTF |
| --- | --- | --- | --- |
| Corpo | 12 pt, entrelinhas 1,5 | `font-size: 12pt; line-height: 1.5;` | `\fs24\sl360\slmult1` |
| Alinhamento | Justificado | `text-align: justify; hyphens: auto;` | `\qj` + `\hyphauto1` |
| Recuo de parágrafo | 1,25 cm na primeira linha | `text-indent: 1.25cm;` | `\fi709` |
| Espaço entre parágrafos | Nenhum | `margin: 0;` | `\sb0\sa0` |
| Idioma | Português do Brasil | `<html lang="pt-BR">` | `\lang1046` |

Nota sobre "1,5 linha": no Word e no RTF, 1,5 linha é proporcional às métricas da fonte (para Times New Roman e Arial, o espaçamento simples fica perto de 1,15 em). Em CSS, `line-height: 1.5` gera texto um pouco mais compacto que o equivalente do Word. Se a meta for paridade visual entre PDF e RTF, use `line-height: 1.725` para 1,5 linha e `1.15` para simples, e valide comparando as duas saídas.

## 4. Títulos (headings)

`#` é o título do documento; `##` a `######` são as seções numeradas, com destaque decrescente e idêntico no texto e no sumário (se houver).

| Markdown | Papel | Exemplo renderizado | Formatação |
| --- | --- | --- | --- |
| `#` | Título do documento | RELATÓRIO DE ATIVIDADES | Centralizado, maiúsculas, negrito, 12 pt, sem número |
| `##` | Seção primária | 1 INTRODUÇÃO | Maiúsculas, negrito |
| `###` | Seção secundária | 1.1 CONTEXTO | Maiúsculas, sem negrito |
| `####` | Seção terciária | 1.1.1 Objetivos | Negrito |
| `#####` | Seção quaternária | 1.1.1.1 Objetivo geral | Sem destaque |
| `######` | Seção quinária | 1.1.1.1.1 Recorte | Itálico |

Regras comuns a todos os títulos de seção:

- Alinhados à esquerda, sem recuo de primeira linha, mesmo tamanho do corpo (12 pt).
- Número em arábicos, separado do título por um espaço, sem ponto, hífen ou travessão depois do número.
- Título com mais de uma linha: a continuação alinha sob a primeira letra da primeira palavra (recuo pendente). CSS: `padding-left` + `text-indent` negativo; RTF: `\li` + `\fi` negativo.
- Um espaço de 1,5 linha antes e depois. CSS: `margin: 1.5em 0;` (ou 1,725em pelo critério da seção 3); RTF: `\sb360\sa360`.
- Nunca sozinho no fim da página. CSS: `break-after: avoid;`; RTF: `\keepn`.
- Títulos sem número (ex.: "REFERÊNCIAS", "ANEXO"): centralizados. Sugestão de sintaxe: `## REFERÊNCIAS {.unnumbered}` ou lista fixa de palavras reconhecidas.
- Seção primária em nova página: opcional em documento formal (token `secao_primaria_nova_pagina: false`).

## 5. Listas (marcadores)

A ABNT (NBR 6024) só define **alíneas**; marcadores gráficos não são previstos. Mapeamento recomendado:

| Markdown | Renderização | Regra |
| --- | --- | --- |
| Lista ordenada `1.` | a), b), c) | Letra minúscula seguida de parêntese |
| Lista não ordenada `-` | a), b), c) (modo estrito) ou • (modo flexível) | Token `lista_nao_ordenada: alinea \| marcador` |
| Lista aninhada (2º nível) | – (travessão) seguido de espaço | Subalínea, conforme NBR 6024 |
| Lista de tarefas `- [ ]` | ☐ / ☑ | Fora da norma; manter como marcador |

Formatação:

- Recuo esquerdo das alíneas: 1,25 cm; continuação da linha alinhada sob a primeira letra do texto da alínea (recuo pendente). RTF: `\li1276\fi-567` (ajuste conforme a largura do marcador).
- Subalíneas: recuo adicional em relação à alínea.
- Entrelinhas 1,5, sem espaço extra entre itens.
- No modo estrito, a norma pede texto iniciado em minúscula, itens terminados em ponto e vírgula e o último em ponto. O exportador não deve reescrever o texto do usuário; no máximo, um aviso de validação ("lint") opcional.

## 6. Ênfase e elementos de linha

| Markdown | Regra |
| --- | --- |
| `**negrito**` | Negrito |
| `*itálico*` | Itálico; usar para estrangeirismos e expressões latinas (*et al.*, *apud*) |
| `` `código` `` | Fonte monoespaçada, mesmo tamanho do corpo |
| `[texto](url)` | PDF: link clicável, sem cor e sem sublinhado (ou cor discreta configurável). RTF: campo `HYPERLINK`. Opção de imprimir a URL entre parênteses para versões impressas |
| `~~riscado~~` | Riscado (fora da norma, mantido) |

## 7. Citações longas (blockquote)

`>` em Markdown representa a citação direta com mais de três linhas (NBR 10520:2023).

| Regra | CSS | RTF |
| --- | --- | --- |
| Recuo esquerdo de 4 cm | `margin-left: 4cm;` | `\li2268` |
| Fonte menor (10 pt) | `font-size: 10pt;` | `\fs20` |
| Entrelinhas simples | `line-height: 1;` (ou 1,15) | `\sl240\slmult1` |
| Sem aspas, sem recuo de primeira linha, justificado | `text-indent: 0; quotes: none;` | `\fi0\qj` |
| Separada do texto por um espaço 1,5 antes e depois | `margin: 1.5em 0 1.5em 4cm;` | `\sb360\sa360` |

A chamada da fonte, como "(Silva, 2020, p. 30).", fica na última linha da própria citação; o usuário a escreve dentro do blockquote.

## 8. Notas de rodapé

Sintaxe: `texto[^1]` e `[^1]: conteúdo da nota.`

| Regra | CSS (WeasyPrint/Paged.js) | RTF |
| --- | --- | --- |
| Chamada em sobrescrito, numeração arábica contínua no documento | `::footnote-call { vertical-align: super; font-size: 7pt; }` | `{\super\chftn}` + `\ftnnar\ftnrstcont` |
| Nota no pé da mesma página | `.nota { float: footnote; }` | `{\footnote ...}` + `\ftnbj` |
| Fonte 10 pt, entrelinhas simples | `font-size: 10pt; line-height: 1;` | `\fs20\sl240\slmult1` |
| Separada do texto por filete de 5 cm a partir da margem esquerda | ver abaixo | o separador padrão do Word tem cerca de 5,08 cm; aceitar o padrão ou definir `{\*\ftnsep ...}` |
| Segunda linha alinhada sob a primeira letra da primeira palavra | `padding-left` + `text-indent` negativo | `\li` + `\fi` negativo |
| Sem espaço entre notas; apenas espaço simples | `margin: 0;` | `\sb0\sa0` |

Filete de 5 cm em CSS:

```css
@page {
  @footnote {
    background: linear-gradient(#000, #000) no-repeat top left / 5cm 0.5pt;
    padding-top: 6pt;
  }
}
```

## 9. Figuras (imagens)

Toda figura tem identificação **acima** e fonte **abaixo**, mesmo quando produzida pelo autor. Markdown padrão não tem onde guardar a fonte; convenção proposta:

```markdown
![Fluxo de atendimento](fluxo.png "Fonte: elaborado pelo autor (2026).")
```

- `alt` vira o título; `title` vira a linha de fonte.
- Alternativa (sintaxe estilo Pandoc): `![Título](img.png){fonte="Elaborado pelo autor (2026)." largura=12cm}`.

| Parte | Formatação |
| --- | --- |
| Identificação (acima) | `Figura 1 – Título`: palavra designativa, número sequencial automático, travessão, título. Centralizada, 10 pt, entrelinhas simples |
| Imagem | Centralizada, largura máxima = largura útil (16 cm em A4 com estas margens), sem distorcer proporção |
| Fonte (abaixo) | `Fonte: Silva (2020, p. 12).` Alinhada à esquerda da figura ou centralizada (manter um padrão), 10 pt, simples |
| Bloco inteiro | Sem quebra de página no meio. CSS: `break-inside: avoid;`; RTF: `\keepn` nos parágrafos de identificação e imagem |

Outros tipos de ilustração (gráfico, mapa, fotografia, organograma) usam a mesma estrutura, trocando a palavra designativa; cada tipo tem numeração própria. Sugestão: `![Gráfico: Atendimentos por mês](g.png "Fonte: ...")`, em que o prefixo antes dos dois-pontos define o tipo.

## 10. Tabelas e quadros

A ABNT distingue **tabela** (dados numéricos, padrão IBGE, laterais abertas) de **quadro** (informação textual, todas as bordas). Uma tabela GFM não indica qual é qual; convenção proposta, com uma linha de legenda antes da tabela:

```markdown
Tabela: Atendimentos por unidade em 2026

| Unidade | Atendimentos |
| --- | ---: |
| Unidade A | 1.250 |

Fonte: dados do exemplo (2026).
```

Prefixo `Tabela:` ou `Quadro:`; sem prefixo, aplicar o padrão do token `tabela_padrao: quadro`.

| Regra | Tabela (IBGE) | Quadro |
| --- | --- | --- |
| Identificação (acima) | `Tabela 1 – Título` | `Quadro 1 – Título` |
| Bordas externas laterais | Nenhuma | Todas |
| Traços horizontais | Acima e abaixo do cabeçalho e no fim da tabela; nenhum entre linhas de dados | Entre todas as linhas |
| Traços verticais | Só no cabeçalho, se necessário; nunca entre células de dados | Entre todas as colunas |
| Fonte do conteúdo | 10 pt, simples | 10 pt, simples |
| Cabeçalho | Pode usar negrito; repetir no topo de cada página se a tabela continuar | Idem |
| Fonte (abaixo) | `Fonte: ...` obrigatória | Obrigatória |
| Números | Alinhados à direita (respeitar `---:` do Markdown) | Conforme o Markdown |
| Tabela que continua na página seguinte | Repetir cabeçalho; marcar "continua" e "continuação" (padrão IBGE) | Repetir cabeçalho |

CSS: `thead { display: table-header-group; }` para repetir cabeçalho. RTF: `\trhdr` na linha de cabeçalho; bordas por célula com `\clbrdrt`, `\clbrdrb` etc.

## 11. Blocos de código

Fora do escopo da ABNT. Recomendação: fonte monoespaçada 10 pt, entrelinhas simples, alinhado à esquerda, sem recuo de primeira linha, fundo neutro ou borda leve, sem quebra no meio quando couber numa página. Se o código precisar ser referenciado no texto, tratá-lo como `Quadro`, com identificação e fonte.

## 12. Paginação

Documento formal não tem folhas pré-textuais, então a numeração pode aparecer desde a primeira página. Torne configurável.

| Regra | CSS | RTF |
| --- | --- | --- |
| Arábicos, canto superior direito | `@page { @top-right { content: counter(page); } }` | `{\header\pard\qr{\field{\*\fldinst PAGE}}\par}` |
| 2 cm da borda superior e da borda direita | `@top-right { vertical-align: top; padding-top: 2cm; font-size: 10pt; }` (ajustar pela linha de base) | `\headery1134`; a margem direita de 2 cm já posiciona o número |
| Ocultar na primeira página (opcional) | `@page :first { @top-right { content: none; } }` | `\titlepg` com `{\headerf}` vazio |
| Frente e verso: verso no canto superior esquerdo | `@page :left { @top-left { content: counter(page); } @top-right { content: none; } }` | `\facingp` com `{\headerl}` e `{\headerr}` |

## 13. Demais elementos Markdown

| Markdown | Mapeamento |
| --- | --- |
| `---` (regra horizontal) | Quebra de página (token `hr: quebra_pagina \| ignorar \| linha`) |
| Front matter YAML | Metadados do documento: `titulo`, `subtitulo`, `autor`, `local`, `data`. Gerar bloco de identificação sob o título; preencher propriedades do PDF e o grupo `{\info}` do RTF |
| Fórmulas (`$...$`) | Centralizadas, numeração entre parênteses alinhada à direita, se numeradas |
| HTML embutido | Ignorar ou rejeitar na exportação (comportamento imprevisível entre formatos) |

## 14. Sumário (opcional)

Para documentos longos, gerar sumário a partir dos headings (NBR 6027): título "SUMÁRIO" centralizado; seções na mesma grafia e destaque do texto; indicativos alinhados à esquerda; página inicial à direita com pontilhado. CSS: `target-counter(attr(href), page)`; RTF: campo `TOC` (atualizado ao abrir no Word).

## 15. Validações sugeridas (lint, sem alterar o texto)

- Figura ou tabela sem linha de fonte.
- Salto de nível de heading (ex.: `##` direto para `####`).
- Mais de cinco níveis de seção.
- Blockquote com menos de três linhas (provável citação curta, que deveria ficar no corpo do texto entre aspas).
- Imagem mais larga que a área útil (16 cm).
- Nota de rodapé referenciada e não definida, ou definida e não usada.

## 16. Fora do escopo deste perfil

- Estrutura acadêmica (capa, folha de rosto, resumo, elementos pré e pós-textuais): perfil separado.
- Comunicações oficiais (ofício, memorando, despacho) seguem o Manual de Redação da Presidência da República, com regras próprias de margens, fonte e diagramação. Se a ferramenta for usada para esse tipo de documento, vale um segundo perfil de tokens.
- Estilo de citações e referências: o exportador formata a aparência, mas não valida a grafia das chamadas (Silva, 2020) nem das referências.
