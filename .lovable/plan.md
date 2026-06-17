# #10 — Acesso por marca (whitelist por cliente)

## Contexto
Hoje qualquer cliente com `profiles.active=true` enxerga **todas** as marcas publicadas (políticas em `brands`, `products`, `product_images` e no bucket `storage.objects`). Não há como dar acesso parcial — "cliente X só vê marca A e B".

## Modelo
Nova tabela `client_brand_access`:

| coluna       | tipo  |
|--------------|-------|
| `user_id`    | uuid → auth.users |
| `brand_id`   | uuid → brands |
| `created_at` | timestamptz |
| `created_by` | uuid (admin) |

PK composta `(user_id, brand_id)`. RLS:
- admin: tudo (via `has_role`)
- cliente: pode ler **as próprias linhas** (`user_id = auth.uid()`), nunca escrever

Função `public.has_brand_access(_user_id uuid, _brand_id uuid) returns boolean` (security definer, stable):
- retorna `true` se admin **ou** existir linha `(user_id, brand_id)` em `client_brand_access`

## Policies atualizadas
Substituir `using (...is_active_client...)` por `using (... is_active_client AND has_brand_access(auth.uid(), brand_id) ...)` em:
- `brands_clients_read_published`
- `products_clients_read`
- `product_images_clients_read`
- `catalogs_clients_read_published` (em `storage.objects`) — extrair `brand_id` do path via `split_part(name,'/',1)::uuid` (mesmo padrão já em uso) e checar acesso

Resultado: **default-deny**. Cliente sem grants não vê nada.

## Backfill
Para não quebrar acessos existentes ao deploy, inserir um grant `(user_id, brand_id)` para todo cliente ativo × toda marca existente. Admin então remove o que não quiser.

```sql
INSERT INTO public.client_brand_access (user_id, brand_id, created_by)
SELECT p.id, b.id, NULL
FROM public.profiles p
JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'client'
CROSS JOIN public.brands b
WHERE p.active = true
ON CONFLICT DO NOTHING;
```

## UI admin
Em `AdminClients.tsx`, novo botão "Marcas" por linha → dialog com lista de todas as marcas e checkbox por marca. Toggle insere/deleta de `client_brand_access` direto via PostgREST (RLS admin permite). Mostra contador "N/M marcas" na coluna.

## Fora de escopo
- Grupos de clientes / templates de acesso (segue como ideia futura).
- Mudar policies de `orders`/`order_items` — já são por `user_id`, não precisam de filtro por marca (cliente só vê os próprios pedidos de qualquer jeito).
- Edge function intermediária para signed URLs — storage policy já cobre o filtro via path.

## Resultado
Admin escolhe explicitamente quais marcas cada cliente vê. Vitrine, busca, signed URLs de imagens e PDFs ficam todas consistentes pelo mesmo gate (`has_brand_access`). Backfill garante zero regressão para clientes atuais.
