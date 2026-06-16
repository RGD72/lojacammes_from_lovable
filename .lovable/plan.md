## #7 — Normalizar imagens dos produtos

### Problema
Hoje, em `public.products` convivem três campos para representar imagens do mesmo produto:

- `image_url text` — a "primeira" imagem (legado).
- `image_urls text[]` — todas as URLs, na ordem inserida.
- `image_bboxes jsonb[]` — bboxes paralelas, **uma por índice** de `image_urls`.

Manter dois arrays paralelos é frágil:
- Qualquer escrita que mude um sem o outro corrompe o alinhamento.
- Não há como ordenar, marcar uma como "principal", remover uma específica nem armazenar metadados (página de origem, dimensão usada, hash) sem mais arrays paralelos.
- `image_url` é redundante e força a UI a fazer fallback em cada renderizador.

### Mudança
Substituir os três campos por uma tabela filha normalizada:

```text
product_images
  id uuid pk
  product_id uuid fk -> products(id) on delete cascade
  url text not null
  bbox jsonb           -- [x, y, w, h] em frações 0..1, opcional
  page_number int      -- página do catálogo de onde veio
  position int         -- ordem (0 = principal)
  created_at timestamptz
  UNIQUE (product_id, url)
```

RLS: mesma regra de leitura de `products` (admin total; cliente ativo lê quando a marca dona está `published`). Sem INSERT/UPDATE para `authenticated` — só admin e edge functions (service role).

### O que muda no código

1. **Migration**
   - Cria `product_images` + GRANTs + RLS + policies.
   - Backfill: para cada `products.id`, gera linhas a partir de `image_urls`/`image_bboxes` (zip por índice). Se `image_urls` estiver vazio mas `image_url` não, gera uma linha única.
   - Mantém os campos antigos por enquanto (`image_url`, `image_urls`, `image_bboxes`) para não quebrar nada em runtime — derruba numa migration seguinte (#7b) quando todos os readers estiverem migrados.

2. **`process-catalog-page` (edge function)**
   - Em vez do read-modify-write dos arrays, faz `INSERT ... ON CONFLICT (product_id, url) DO NOTHING` em `product_images` com `bbox`, `page_number`, `position`.
   - Para produto novo: cria o produto e insere a primeira `product_images` (`position = 0`).
   - Para repetição da mesma `reference`: insere mais uma `product_images` (próxima `position`).
   - Para de gravar `image_url`/`image_urls`/`image_bboxes`.

3. **Readers** (`ProductDialog`, `BrandShowcase`, `AdminBrandEdit`, `CartDrawer`, `orderPdf`, `UploadCatalogDialog`)
   - Passam a buscar `product_images(url, bbox, position)` (join/embed do PostgREST: `select("*, product_images(url, bbox, position)")`).
   - "Imagem principal" = `product_images` com menor `position` (fallback: primeira).
   - Removem todos os fallbacks `image_url ?? image_urls[0]`.
   - `UploadCatalogDialog` (modo "retomar") deixa de olhar `products.image_url` e usa a nova tabela `catalog_page_jobs` (já existente, do #3) como fonte de páginas pendentes — esse loop já foi migrado parcialmente; aqui só removemos o último vestígio.

4. **`order_items`**
   - Hoje grava `image_url` (snapshot). Mantemos a coluna (snapshot histórico do pedido); muda só a forma como é obtida no submit-order: `select position=0 from product_images where product_id=?`.

### Fora de escopo
- Derrubar `products.image_url` / `image_urls` / `image_bboxes` — fica para uma migration de cleanup (#7b) depois que os readers estiverem em produção e validados.
- Editor de bbox no admin (#9).
- Reordenação manual de imagens (UI).

### Resultado
- Modelo relacional sem arrays paralelos, sem campo redundante.
- Reprocessar uma página vira `INSERT ... ON CONFLICT DO NOTHING` (idempotente).
- Cada imagem ganha bbox/página/ordem próprios sem risco de desalinhamento.
