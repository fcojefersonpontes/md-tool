# Changelog

## Não lançado

- Exportação (Fase 2):
  - **PDF** com o Chrome/Edge/Chromium instalado (puppeteer-core), fiel ao preview:
    realce de código, KaTeX, Mermaid, imagens; tamanho de página, orientação, margens,
    cabeçalho/rodapé com número de página e opções por documento no front-matter (`pdf:`)
  - **RTF** com conversor próprio: títulos com nível de estrutura e marcadores,
    links, listas, tarefas, tabelas, código, citações, notas de rodapé e imagens PNG/JPEG;
    fórmulas KaTeX, diagramas Mermaid e imagens SVG/GIF/WebP são renderizados pelo navegador e
    embutidos como PNG (sem navegador, saem como código/texto, com aviso)
  - Comandos no editor, no Explorer e no preview; progresso cancelável e botões
    "Abrir" / "Mostrar na Pasta"
  - Testes no navegador (`npm run test:browser`) e arquivo de referência para o RTF

- Preview ao vivo de Markdown (Fase 1):
  - GFM: tabelas, task lists clicáveis, notas de rodapé, front-matter oculto
  - Realce de código com shiki (temas claro/escuro do GitHub)
  - Fórmulas com KaTeX e diagramas Mermaid
  - Scroll sincronizado entre editor e preview
  - Links relativos abrem no editor (incluindo `arquivo.md#secao`)
  - Imagens relativas, tema automático/claro/escuro e CSS personalizado
  - CSP com nonce, HTML sanitizado com DOMPurify e Workspace Trust
  - Interface em inglês e português (pt-BR)

## 0.0.1

- Estrutura inicial do projeto (Fase 0).
