## #8 — Backoff, abstração mínima e rastreio de custo do AI Gateway

### Contexto
Hoje `process-catalog-page` chama `https://ai.gateway.lovable.dev/v1/chat/completions` direto, sem retry inteligente (apenas o retry de página no cliente) e sem registrar custo/uso. Isso significa:

- **429 transitório derruba a página** — o retry do cliente ajuda, mas estoura o orçamento de tentativas rapidamente em picos.
- **Zero observabilidade de custo:** não dá para saber quantos tokens/calls cada marca consumiu, nem identificar páginas caras ou regressões do prompt.
- **Lock-in implícito no Gateway:** a chamada está espalhada inline em meio à edge function — trocar provedor exige reescrita.

A abstração "interface de provedor completa" é overkill para o que existe (uma única call de vision + tool). Vamos pelo enxuto.

### Mudanças

**1. Nova tabela `ai_usage_log`**
```text
id uuid pk
created_at timestamptz
function text                -- 'process-catalog-page'
provider text                -- 'lovable-gateway'
model text                   -- 'google/gemini-2.5-flash'
brand_id uuid                -- nullable
page_number int              -- nullable
status int                   -- HTTP status final
attempts int                 -- quantas tentativas até sucesso/falha
duration_ms int
prompt_tokens int
completion_tokens int
total_tokens int
error_message text
run_id text                  -- X-Lovable-AIG-Run-ID (para correlacionar nos logs do Gateway)
```
RLS: só admin lê; service_role escreve. Sem `anon`/`authenticated` insert.

**2. Helper `callAiExtractor` (inline em `process-catalog-page`)**
Encapsula a chamada ao Gateway num único ponto. Implementa:
- Backoff exponencial em 429 e 5xx: tentativas com delays `500ms, 1500ms, 4000ms` (máx 3 tentativas totais).
- Honra `Retry-After` (segundos) quando o Gateway mandar.
- Não tenta de novo em 4xx que não seja 429 (400/401/402/403): retorna o erro imediatamente.
- Captura `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens` da resposta.
- Captura `X-Lovable-AIG-Run-ID` e `X-Lovable-AIG-Log-ID` dos headers para correlação.
- Adiciona header `X-Lovable-AIG-SDK: native-fetch` para telemetria.

Retorna `{ products, usage, runId, status, attempts, durationMs }` ou lança erro com `status` anotado.

**3. Persistir o uso**
Ao fim de cada call (sucesso ou erro), `INSERT` em `ai_usage_log` com os campos acima. Best-effort — falha no insert não derruba o processamento.

**4. Mensagens de erro mais precisas**
Mapear status do Gateway:
- 429 (após retries) → "Limite de taxa do AI excedido — tente novamente em alguns minutos."
- 402 → "Créditos do AI esgotados."
- 5xx (após retries) → "AI gateway instável; tente novamente."

### Não-objetivos
- Abstração completa de provedor (OpenAI/Anthropic/etc.).
- Adoção do Vercel AI SDK — a chamada atual é tool-calling com `image_url`, segue funcionando com `fetch` puro. Migração para o SDK fica como item separado se quisermos streaming/embeddings.
- UI de custos no admin (planilha viva). Por agora, o admin consulta `ai_usage_log` via SQL/Supabase.

### Resultado
- Resiliente a 429/5xx transitórios sem cascata de retries do cliente.
- Cada chamada deixa rastro de custo correlacionável com `run_id` dos logs do Gateway.
- Trocar provedor amanhã = reescrever só o helper.
