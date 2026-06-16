## #9 — Editor de bbox no admin (revisão de recortes do AI)

### Contexto
O `process-catalog-page` pede ao Gemini um `bbox: [x,y,w,h]` normalizado por imagem e usa esse recorte na vitrine (via `BboxImage` em `ProductDialog.tsx` / `BrandShowcase.tsx`). Quando o AI erra (corta cabeça, inclui produto vizinho, bbox quase 0×0), hoje **não há como corrigir** sem editar JSON cru no banco. `AdminBrandEdit.tsx` mostra a thumb mas não permite ajustar o enquadramento.

### Mudanças

**1. Persistência da página renderizada**
Já temos `catalog-pages/brand_<id>/page_<n>.jpg` no Storage (bucket privado). Vamos:
- Adicionar `page_image_path text` em `product_images` (nullable, populado no insert via `process-catalog-page`) para sabermos qual JPG da página gerou cada recorte.
- Backfill: para registros existentes, derivar do `(brand_id, page_number)` do produto pai.

**2. UI: `BboxEditor` (novo componente)**
Modal acionado por um botão "Ajustar recorte" em cada thumb de produto em `AdminBrandEdit.tsx`. Mostra:
- Imagem da página inteira (signed URL do `page_image_path`), com overlay de um retângulo arrastável/redimensionável representando o bbox normalizado.
- Mostra TODOS os bboxes dos outros produtos da mesma página em cinza (read-only) para evitar sobreposição acidental.
- Controles: arrastar para mover, alças nos 4 cantos para redimensionar, snap suave a 1% da página.
- Preview ao vivo do crop (mesma transform do `BboxImage`).
- Botões: **Salvar**, **Resetar para AI**, **Cancelar**.

**3. Persistência**
- Salvar emite `UPDATE product_images SET bbox = $1 WHERE id = $2`.
- Como `product_images` já tem RLS admin-full-access, basta o client chamar PostgREST direto. Sem edge function nova.
- Valida 0 ≤ x,y,w,h ≤ 1, w*h ≥ 0.01, x+w ≤ 1, y+h ≤ 1.

**4. Indicador de bbox suspeito**
Em `AdminBrandEdit.tsx`, badge "⚠ recorte" ao lado de produtos cujo bbox tenha área < 5% ou que estejam em `[0,0,1,1]` (default não-extraído). Ajuda admin a focar nos casos ruins primeiro.

### Não-objetivos
- Re-rodar AI ou mexer no prompt — só correção manual.
- Edição de qual imagem é capa (drag-reorder) — segue como item separado.
- Recorte server-side físico (gerar novo JPG cropado em `product-images`). Mantemos a estratégia atual: imagem da página inteira + transform CSS via bbox, que é o que `BboxImage` já faz e funciona bem.

### Resultado
- Admin corrige enquadramentos errados em segundos, sem mexer em SQL.
- Vitrine reflete a correção imediatamente (mesma source-of-truth `product_images.bbox`).
- Confiabilidade percebida do AI sobe sem precisar retreinar prompt.

### Detalhes técnicos
- Migration: `ALTER TABLE product_images ADD COLUMN page_image_path text;` + backfill via `UPDATE product_images SET page_image_path = 'brand_'||p.brand_id||'/page_'||p.page_number||'.jpg' FROM products p WHERE product_images.product_id = p.id;`
- `process-catalog-page`: ao inserir `product_images`, popular `page_image_path` com o mesmo path que já é usado no upload da página.
- Novo arquivo: `src/components/admin/BboxEditor.tsx` (dialog + canvas overlay puro em CSS/JS, sem libs novas; pointer events para drag/resize).
- Em `AdminBrandEdit.tsx`: trazer `product_images(id, url, bbox, position, page_image_path)` no select, expandir thumbnail para listar as N imagens em grid pequeno, cada uma com "Ajustar".
