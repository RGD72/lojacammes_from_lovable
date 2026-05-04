
# Plataforma B2B de Pedidos por Catálogo

Plataforma web responsiva (PWA) onde um admin sobe catálogos PDF de marcas, a IA extrai os produtos automaticamente, e clientes cadastrados navegam vitrines e enviam pedidos (sem pagamento — registro de intenção de compra).

## Adaptações de stack

A especificação original cita Next.js + FastAPI + Railway + OpenAI. Como Lovable usa **React + Vite** e roda backend via **Edge Functions Deno** (sem servidor Python persistente), faremos as seguintes equivalências mantendo 100% das funcionalidades:

| Original | No Lovable |
|---|---|
| Next.js 14 PWA | React + Vite + manifest/service worker (PWA) |
| Supabase (auth/DB/storage) | Lovable Cloud (Supabase gerenciado) |
| FastAPI Python no Railway | Edge Functions (Deno/TS) |
| OpenAI GPT-4o Vision (chave do admin) | Lovable AI Gateway com Gemini Vision (sem chave manual) |
| Resend | Lovable Emails (built-in) |
| react-pdf | jsPDF / pdf-lib no cliente |

Direção visual: paleta **Areia quente** (#faf8f5, #f0ebe3, #c9b99a, #8b7355), tipografia editorial leve, foco no produto.

---

## Módulo 1 — Administrador

**Auth única do admin** (email/senha, papel `admin` em `user_roles`).

**Painel inicial** com:
- Cards de marcas com status (Processando / Publicada / Não publicada)
- Badge de pedidos novos
- Acesso a: Vitrines, Clientes, Pedidos, Configurações

**Upload de catálogo:**
- Form: nome da marca + arquivo PDF (até 50MB) → upload ao Storage
- Botão "Processar catálogo" dispara pipeline assíncrono
- Indicador de progresso por página

**Pipeline (Edge Function `process-catalog`):**
1. Renderiza cada página do PDF como imagem em alta resolução
2. Salva imagens da página no Storage (capa + páginas + thumbs)
3. Para cada página, envia a imagem ao Lovable AI (Gemini Vision) com prompt estruturado pedindo JSON via tool calling: `reference, description, material, colors[], sizes[], price`
4. Todos produtos da mesma página → mesmo `look_id`
5. Persiste em `products` vinculados a `brand_id`
6. Marca a vitrine como pronta (status `unpublished`, aguardando revisão)

**Edição manual da vitrine:**
- Tabela editável de produtos: ref, descrição, material, cores, tamanhos, preço
- Adicionar/remover produtos, reordenar (drag), trocar imagem, mover entre looks

**Publicação:** toggle Publicada/Não publicada por marca.

**Gestão de clientes:** CRUD completo (nome, email, senha inicial, ativo/inativo). Sem auto-cadastro. Inativo não loga.

**Gestão de pedidos:**
- Lista filtrável por marca e data
- Detalhes: cliente, marca, itens, total
- Status: Novo / Visualizado / Confirmado / Cancelado
- Exportação CSV por marca

---

## Módulo 2 — Cliente

**Login obrigatório** (email/senha). Sem auto-cadastro, sem reset autônomo.

**Home:** grid de vitrines publicadas (capa = primeira página do catálogo + nome da marca).

**Vitrine da marca:**
- Grid de produtos com foto, referência, preço
- Agrupamento visual por LOOK (produtos da mesma página juntos, com badge "Look N")
- Filtro por descrição/categoria
- Botão "Baixar catálogo PDF" (arquivo original)
- Ícone de carrinho dessa marca com contador

**Página/modal do produto:** foto, referência, descrição, material, preço, botão "Escolher".

**Popup de seleção:**
- Seletor de cor (oculto se houver só uma)
- Seletor de tamanho (botões)
- Quantidade (mín. 1)
- Validação: cor e tamanho obrigatórios
- "Escolhido" → adiciona ao carrinho da marca

**Carrinho (separado por marca):**
- Tabela: Referência | Descrição | Cor | Tamanho | Qtd | Cliente | Valor unit. | Valor total
- Nome do cliente preenchido automaticamente
- Editar quantidade, remover itens, subtotais e total
- Botão "Enviar pedido"

**Envio do pedido:**
1. Salva em `orders` + `order_items`
2. Admin recebe badge "novo pedido" no painel
3. Edge Function envia email para o admin via Lovable Emails com tabela formatada
4. Cliente vê tela de confirmação
5. Botão "Baixar pedido em PDF" (gerado no cliente com jsPDF: cliente, data/hora, marca, tabela completa, total)

---

## Módulo 3 — Banco de dados

```text
brands          (id, name, status, catalog_pdf_url, cover_image_url, created_at)
products        (id, brand_id, page_number, look_id, reference, description,
                 material, colors text[], sizes text[], price, image_url, sort_order)
profiles        (id → auth.users, name, active)
user_roles      (id, user_id, role: 'admin'|'client')   -- segurança via has_role()
orders          (id, brand_id, user_id, status, total, created_at)
order_items     (id, order_id, product_id, reference, description,
                 color, size, quantity, unit_price)
```

RLS:
- `products`/`brands`: clientes leem apenas marcas `published`; admin tudo
- `orders`/`order_items`: cliente lê só os próprios; admin lê todos
- Storage: bucket `catalogs` privado (signed URLs); bucket `product-images` público

---

## Regras de negócio

- 1 catálogo = 1 marca = 1 vitrine = 1 base de pedidos independente
- Mesmo `look_id` agrupa produtos da mesma página (selecionáveis individualmente)
- Campos não detectados ficam vazios para edição manual
- Sem estoque, sem pagamento
- Admin é o único criador/editor de dados
- Cliente apenas lê e envia pedidos

---

## Fases de entrega

**Fase 1 — Fundação**
Lovable Cloud, schema completo, RLS, roles, auth admin/cliente, layout base com paleta Areia Quente, PWA manifest.

**Fase 2 — Pipeline de catálogo**
Upload PDF, edge function `process-catalog` com Gemini Vision, persistência de produtos/looks, tela de edição manual, toggle de publicação.

**Fase 3 — Vitrines (cliente)**
Home com marcas publicadas, vitrine com grid agrupado por look, página/modal de produto, download do catálogo original.

**Fase 4 — Carrinho e pedidos**
Popup cor/tamanho/qtd, carrinho por marca, envio do pedido, email ao admin, confirmação + PDF do pedido.

**Fase 5 — Painel admin completo**
CRUD de clientes, gestão de pedidos com status, filtros, exportação CSV, badge de novos pedidos.

---

## Detalhes técnicos

- **Edge Functions:** `process-catalog` (render + IA + persist), `notify-new-order` (email)
- **Render PDF→imagem no edge:** usa `pdfjs-dist` em Deno; fallback: cliente renderiza páginas e envia imagens
- **IA:** `google/gemini-3-flash-preview` com tool calling para JSON estruturado por página
- **PWA:** `vite-plugin-pwa` com manifest, ícones, offline shell
- **PDF do pedido:** `jspdf` + `jspdf-autotable` no cliente
- **CSV:** geração no cliente a partir da query
- **Validação:** Zod em forms e edge functions
