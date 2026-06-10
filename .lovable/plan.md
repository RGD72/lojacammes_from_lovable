
# Documento de Especificação — Cammes.com.br

Vou gerar um documento técnico detalhado descrevendo o **estado atual** do produto (sem histórico de mudanças), pronto para um desenvolvedor sênior replicar do zero.

## Entregáveis

1. `Cammes-Especificacao-Tecnica.md` — documento principal em Markdown
2. `Cammes-Especificacao-Tecnica.pdf` — versão PDF para leitura/compartilhamento

Ambos salvos em `/mnt/documents/` e disponibilizados via `presentation-artifact`.

## Estrutura do documento

1. **Visão geral do produto**
   - O que é: plataforma B2B de pedidos por catálogo (vitrines de marcas de moda)
   - Atores: 1 Admin (gestor) + N Clientes B2B
   - Fluxo macro: Admin sobe PDF → IA extrai produtos → Admin revisa/publica → Cliente navega → Cliente envia pedido → Admin recebe e-mail

2. **Stack técnica**
   - Frontend: React 18 + Vite 5 + TypeScript + Tailwind v3 + shadcn/ui
   - Backend: Supabase (Postgres + Auth + Storage + Edge Functions Deno)
   - IA: Lovable AI Gateway, modelo `google/gemini-2.5-flash` com tool calling
   - PDF render no cliente: `pdfjs-dist`; geração de pedido em PDF: `jspdf` + `jspdf-autotable`
   - E-mail: Lovable Emails (Resend)
   - PWA: manifest + service worker

3. **Identidade visual**
   - Nome: Cammes.com.br
   - Paleta "Areia Quente" (#faf8f5, #f0ebe3, #c9b99a, #8b7355)
   - Tipografia editorial, foco no produto
   - Tokens em `src/index.css` + `tailwind.config.ts`

4. **Modelo de dados (Postgres)**
   - Tabelas: `brands`, `products`, `profiles`, `user_roles`, `orders`, `order_items`
   - Enum `app_role` (`admin` | `client`)
   - Colunas-chave de `products`: `reference`, `image_urls[]`, `image_bboxes jsonb[]`, `look_id`, `page_number`
   - Colunas-chave de `brands`: `status` (processing/unpublished/published), `total_pages`, `processed_pages`, `catalog_pdf_url`, `cover_image_url`
   - Funções: `has_role`, `is_active_client`, `admin_exists`, `handle_new_user`, `update_updated_at_column`
   - RLS detalhada por tabela + GRANTs

5. **Storage**
   - Buckets: `catalogs` (PDFs originais), `catalog-pages` (páginas renderizadas), `product-images`
   - Todos públicos no estado atual

6. **Autenticação e papéis**
   - E-mail/senha; sem auto-cadastro
   - Bootstrap do primeiro admin via edge function `bootstrap-admin`
   - Trigger `handle_new_user` cria profile + role `client`
   - Admin gerencia clientes via edge functions `admin-create-user` / `admin-update-user`

7. **Pipeline de processamento de catálogo (detalhado)**
   - Upload do PDF (até **400 MB**) ao bucket `catalogs`
   - Cliente renderiza cada página com `pdfjs-dist` (alta resolução) e faz upload ao `catalog-pages`
   - Para cada página, chamada à edge function `process-catalog-page`:
     - Modelo `google/gemini-2.5-flash` + tool `extract_products`
     - Prompt extrai: `reference, description, material, colors[], sizes[], price, bbox` (normalizado 0..1)
     - **Validação estrita de referência**: regex alfanumérica com ≥1 dígito; rejeita "look", "page", "ref", etc.
     - Produtos sem referência válida são descartados (evita lixo)
     - Mesma página → mesmo `look_id`
     - Mesma referência em múltiplas páginas → acumula `image_urls` + `image_bboxes`
     - Primeira página vira `cover_image_url`
     - Atualiza `processed_pages`; ao concluir, status passa a `unpublished`
   - Progresso por página exibido no painel admin

8. **Módulo Admin (rotas `/admin/*`)**
   - `/admin` — grid de vitrines com status e botão de upload
   - `/admin/brands/:id` — edição da vitrine (CRUD de produtos, reordenar, trocar imagem, publicar)
   - `/admin/clients` — CRUD de clientes (ativo/inativo)
   - `/admin/orders` — lista filtrada, detalhe, status (Novo/Visualizado/Confirmado/Cancelado), export CSV
   - Badge de novos pedidos

9. **Módulo Cliente (rotas `/`)**
   - Home: grid de marcas `published`
   - `/brand/:id` — vitrine agrupada por LOOK, filtros, download do PDF original
   - Modal de produto: cor, tamanho, quantidade, "Escolher"
   - Carrinho por marca (`CartDrawer`), tabela editável, "Enviar pedido"
   - Pós-envio: tela de confirmação + download do pedido em PDF (jsPDF)

10. **Edge Functions**
    - `process-catalog-page` (verify_jwt=false, valida admin internamente)
    - `notify-new-order` (e-mail ao admin)
    - `bootstrap-admin`, `admin-create-user`, `admin-update-user`
    - Snippets dos cabeçalhos CORS e padrão de validação de role

11. **Segurança**
    - Roles SEMPRE em `user_roles` (nunca em `profiles`)
    - `has_role` SECURITY DEFINER usado em todas as policies
    - GRANTs explícitos por tabela
    - Cliente bloqueado se `profiles.active = false`

12. **Configuração e variáveis**
    - Secrets necessárias: `LOVABLE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
    - `supabase/config.toml` — funções com `verify_jwt = false`

13. **Regras de negócio (resumo)**
    - 1 catálogo = 1 marca = 1 vitrine = 1 base de pedidos
    - Produtos sem referência visível NÃO são importados
    - Sem estoque, sem pagamento — pedido = registro de intenção
    - Vitrine só fica visível ao cliente quando `published`

14. **Passos de bootstrap para replicar**
    - Criar projeto Supabase, rodar migrations, criar buckets, deployar funções
    - Configurar secrets, fazer bootstrap do admin
    - Subir o primeiro catálogo de teste

## Geração

- Markdown escrito à mão (sem dependências)
- PDF via `pandoc` (já disponível no sandbox) com tema simples
- QA: converter PDF para imagens e inspecionar visualmente antes de entregar

Posso prosseguir?
