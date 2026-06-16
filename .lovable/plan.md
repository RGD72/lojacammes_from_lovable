## #3 — Ingestão recuperável (também resolve #4)

### Contexto
Hoje a orquestração inteira vive no navegador: render PDF → upload página por página → invoca `process-catalog-page`. Se a aba fechar, a marca fica presa em `processing` e a única "fonte de verdade" do progresso é o contador `brands.processed_pages`, atualizado por read-modify-write (não-atômico — #4).

Reescrever para orquestração 100% server-side exigiria renderizar PDF dentro de uma edge function Deno (sem biblioteca madura) ou substituir o pipeline pelo modelo "PDF nativo no Gemini" (como o `cammes` faz), o que muda o produto (perde recortes por bbox).

### Proposta enxuta (pragmática)
Manter o cliente renderizando o PDF (ele já tem o arquivo na máquina antes do upload), mas **mover a fonte de verdade do progresso para o banco** numa tabela idempotente por página. Isso elimina o contador frágil, dá retomada confiável e prepara o terreno para um worker server-side no futuro.

### Mudanças

**1. Nova tabela `catalog_page_jobs`**
```text
brand_id uuid, page_number int, status text (pending|done|error),
error_message text, attempts int, created_at, updated_at
UNIQUE(brand_id, page_number)
```
RLS: admin total; cliente nenhum acesso.

**2. `process-catalog-page` (edge function)**
- No início: `UPSERT` em `catalog_page_jobs` com `status='pending'`, `attempts = attempts + 1`.
- No sucesso: `UPDATE ... SET status='done', error_message=null`.
- No erro: `UPDATE ... SET status='error', error_message=...`.
- **Remove** o read-modify-write de `brands.processed_pages` (resolve #4).
- Quando a página marcar `done`, recalcula `processed_pages = count(*) FROM catalog_page_jobs WHERE brand_id=? AND status='done'`. Se igual a `total_pages`, marca `status='unpublished'`. Tudo numa única transação via RPC `recount_brand_progress(brand_id)`.

**3. Cliente `UploadCatalogDialog`**
- Em modo "novo": como hoje, mas a lista de páginas pendentes vem de `catalog_page_jobs` (não mais de `products.page_number`).
- Em modo "retomar": consulta `catalog_page_jobs WHERE brand_id=? AND status != 'done'` para saber o que reprocessar. Páginas com `status='done'` são puladas mesmo que o usuário re-renderize tudo.
- Mantém o loop sequencial e o cancel atual.

**4. Função `admin-resume-brand` (opcional, pequena)**
Permite ao admin "destravar" uma marca presa: zera `status` para `processing` e devolve a lista de páginas pendentes — útil quando a aba caiu sem nem ter renderizado.

### Fora de escopo (separar em itens próprios)
- Worker server-side que orquestra sem o navegador (exige render de PDF no Deno ou mudar o modelo de extração — proposta #3 do `cammes`).
- Substituir bbox-extraction por PDF-nativo no Gemini.
- Editor de revisão de bbox no admin (#9).

### Resultado
- Retomada confiável após queda de aba/conexão (sem reimportar páginas já feitas).
- Progresso atômico, sem corrida (resolve #4 sem migração adicional).
- Mantém o produto atual (bbox, recortes) intacto.
