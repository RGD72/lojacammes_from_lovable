// Receives one rendered PDF page (image data URL) and extracts products via Lovable AI Vision.
// Stores the page image, persists products, and updates brand progress.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You analyze fashion catalog pages and extract every product visible.
Return STRICT JSON via the provided tool. ONLY include products whose reference (SKU/code) is clearly written/visible on the page. If no reference text is visible for an item, DO NOT include it. For each included product return reference (SKU/code), description (short), material, colors (array of strings), sizes (array like S, M, L, 38, 40), price as a number (0 if unknown), and bbox: the normalized bounding box [x, y, w, h] (each value between 0 and 1, relative to page width/height) framing the SINGLE product photo that is physically CLOSEST to that reference label on the page.

CRITICAL bbox rules:
- The bbox MUST fully contain the garment being sold (the entire piece must be visible — never cut sleeves, hems, collars or details). When the piece is worn by a model, frame the model's body so the garment is centered and complete; include enough surrounding context (head-to-knee at minimum when the photo allows). Prefer a slightly LOOSE crop over a tight one — add ~5% padding around the garment on every side.
- Each product must point to ONE distinct photo region — never reuse the same bbox for two references.
- If a non-reference field is unknown, use empty string or empty array; price 0.
- If you cannot determine the bbox, return [0,0,1,1].
- Multiple products on the same page belong to the same look.`;

const TOOL = {
  type: "function",
  function: {
    name: "extract_products",
    description: "Extract products from a catalog page",
    parameters: {
      type: "object",
      properties: {
        products: {
          type: "array",
          items: {
            type: "object",
            properties: {
              reference: { type: "string" },
              description: { type: "string" },
              material: { type: "string" },
              colors: { type: "array", items: { type: "string" } },
              sizes: { type: "array", items: { type: "string" } },
              price: { type: "number" },
              bbox: {
                type: "array",
                items: { type: "number" },
                minItems: 4,
                maxItems: 4,
                description: "Normalized [x, y, w, h] of the product photo closest to this reference (0..1).",
              },
            },
            required: ["reference", "description", "material", "colors", "sizes", "price", "bbox"],
            additionalProperties: false,
          },
        },
      },
      required: ["products"],
      additionalProperties: false,
    },
  },
};

const AI_MODEL = "google/gemini-2.5-flash";
const AI_PROVIDER = "lovable-gateway";
const AI_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_AI_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1500, 4000];

interface AiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface AiCallResult {
  products: any[];
  usage: AiUsage;
  runId: string | null;
  status: number;
  attempts: number;
  durationMs: number;
}

class AiCallError extends Error {
  status: number;
  attempts: number;
  durationMs: number;
  runId: string | null;
  usage: AiUsage;
  constructor(opts: {
    message: string;
    status: number;
    attempts: number;
    durationMs: number;
    runId: string | null;
    usage?: AiUsage;
  }) {
    super(opts.message);
    this.status = opts.status;
    this.attempts = opts.attempts;
    this.durationMs = opts.durationMs;
    this.runId = opts.runId;
    this.usage = opts.usage ?? {};
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s) && s >= 0) return Math.min(Math.floor(s * 1000), 15000);
  return null;
}

/**
 * Wraps the Lovable AI Gateway call. Encapsulates retry/backoff on 429 and 5xx,
 * extracts usage metrics, captures the AIG run id and returns parsed products.
 * Throws AiCallError on terminal failure (with status/attempts annotated).
 */
async function callAiExtractor(opts: {
  aiKey: string;
  pageNumber: number;
  imageUrl: string;
}): Promise<AiCallResult> {
  const started = Date.now();
  let lastStatus = 0;
  let lastBody = "";
  let runId: string | null = null;

  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
    const resp = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.aiKey}`,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "native-fetch",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Extract all products visible on page ${opts.pageNumber}.` },
              { type: "image_url", image_url: { url: opts.imageUrl } },
            ],
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "extract_products" } },
      }),
    });

    lastStatus = resp.status;
    runId = resp.headers.get("X-Lovable-AIG-Run-ID") ?? runId;

    if (resp.ok) {
      const aiJson = await resp.json();
      const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      let products: any[] = [];
      if (toolCall?.function?.arguments) {
        try {
          products = JSON.parse(toolCall.function.arguments).products ?? [];
        } catch (e) {
          console.error("parse tool args failed", e);
        }
      }
      const usage: AiUsage = aiJson.usage ?? {};
      return {
        products,
        usage: {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        },
        runId,
        status: resp.status,
        attempts: attempt,
        durationMs: Date.now() - started,
      };
    }

    lastBody = await resp.text();
    console.error("AI error", resp.status, lastBody.slice(0, 500));

    // Retry only on 429 and 5xx.
    const retriable = resp.status === 429 || resp.status >= 500;
    if (!retriable || attempt === MAX_AI_ATTEMPTS) break;

    const retryAfter = parseRetryAfter(resp.headers.get("Retry-After"));
    const delay = retryAfter ?? BACKOFF_MS[attempt - 1] ?? 4000;
    await sleep(delay);
  }

  const msg =
    lastStatus === 429
      ? "Limite de taxa do AI excedido — tente novamente em alguns minutos."
      : lastStatus === 402
        ? "Créditos do AI esgotados. Adicione créditos no workspace."
        : lastStatus >= 500
          ? "AI gateway instável; tente novamente."
          : `AI gateway erro ${lastStatus}`;

  throw new AiCallError({
    message: msg,
    status: lastStatus,
    attempts: MAX_AI_ATTEMPTS,
    durationMs: Date.now() - started,
    runId,
  });
}

async function logAiUsage(
  admin: ReturnType<typeof createClient>,
  row: {
    function: string;
    model: string;
    brand_id: string | null;
    page_number: number | null;
    status: number | null;
    attempts: number;
    duration_ms: number;
    usage: AiUsage;
    error_message: string | null;
    run_id: string | null;
  },
) {
  try {
    await admin.from("ai_usage_log").insert({
      function: row.function,
      provider: AI_PROVIDER,
      model: row.model,
      brand_id: row.brand_id,
      page_number: row.page_number,
      status: row.status,
      attempts: row.attempts,
      duration_ms: row.duration_ms,
      prompt_tokens: row.usage.prompt_tokens ?? null,
      completion_tokens: row.usage.completion_tokens ?? null,
      total_tokens: row.usage.total_tokens ?? null,
      error_message: row.error_message,
      run_id: row.run_id,
    });
  } catch (e) {
    console.error("ai_usage_log insert failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let jobBrandId: string | null = null;
  let jobPageNumber: number | null = null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const aiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!aiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    if (!roles?.some((r) => r.role === "admin")) return json({ error: "Forbidden" }, 403);

    const { brand_id, page_number, page_url, page_path, total_pages, is_first } = await req.json();
    if (!brand_id || !page_number || !page_url) {
      return json({ error: "brand_id, page_number, page_url required" }, 400);
    }
    jobBrandId = brand_id;
    jobPageNumber = page_number;
    const pageUrl: string = page_url;

    // Mark the page job as pending (idempotent) and bump attempts.
    await admin
      .from("catalog_page_jobs")
      .upsert(
        {
          brand_id,
          page_number,
          status: "pending",
          error_message: null,
        },
        { onConflict: "brand_id,page_number" },
      );
    // Increment attempts in a separate update so upsert doesn't reset it.
    {
      const { data: jobRow } = await admin
        .from("catalog_page_jobs")
        .select("attempts")
        .eq("brand_id", brand_id)
        .eq("page_number", page_number)
        .maybeSingle();
      await admin
        .from("catalog_page_jobs")
        .update({ attempts: (jobRow?.attempts ?? 0) + 1 })
        .eq("brand_id", brand_id)
        .eq("page_number", page_number);
    }

    // Buckets are now private. Generate a short-lived signed URL so the AI
    // gateway can fetch the page image. We keep `pageUrl` (the public-format
    // URL) as the value stored in the DB so the client-side signer can
    // re-issue signed URLs on demand from the same stable string.
    let pathForSign: string | null = typeof page_path === "string" ? page_path : null;
    if (!pathForSign) {
      const m = pageUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/catalog-pages\/([^?]+)/);
      if (m) pathForSign = decodeURIComponent(m[1]);
    }
    let aiImageUrl = pageUrl;
    if (pathForSign) {
      const { data: signed, error: sErr } = await admin.storage
        .from("catalog-pages")
        .createSignedUrl(pathForSign, 60 * 60);
      if (sErr || !signed?.signedUrl) {
        console.error("sign page url failed", sErr);
        return json({ error: "Failed to sign page URL" }, 500);
      }
      aiImageUrl = signed.signedUrl;
    }

    // First page becomes the cover
    if (is_first) {
      await admin.from("brands").update({
        cover_image_url: pageUrl,
        total_pages: total_pages ?? null,
      }).eq("id", brand_id);
    }

    // Call Lovable AI gateway with vision + tool calling
    let products: any[] = [];
    try {
      const result = await callAiExtractor({
        aiKey,
        pageNumber: page_number,
        imageUrl: aiImageUrl,
      });
      products = result.products;
      // Best-effort usage tracking on success.
      await logAiUsage(admin, {
        function: "process-catalog-page",
        model: AI_MODEL,
        brand_id,
        page_number,
        status: result.status,
        attempts: result.attempts,
        duration_ms: result.durationMs,
        usage: result.usage,
        error_message: null,
        run_id: result.runId,
      });
    } catch (err) {
      const e = err as AiCallError;
      await logAiUsage(admin, {
        function: "process-catalog-page",
        model: AI_MODEL,
        brand_id,
        page_number,
        status: e.status ?? null,
        attempts: e.attempts ?? 1,
        duration_ms: e.durationMs ?? 0,
        usage: e.usage ?? {},
        error_message: e.message,
        run_id: e.runId ?? null,
      });
      await admin
        .from("catalog_page_jobs")
        .update({ status: "error", error_message: e.message })
        .eq("brand_id", brand_id)
        .eq("page_number", page_number);
      const httpStatus = e.status === 429 ? 429 : e.status === 402 ? 402 : 500;
      return json({ error: e.message }, httpStatus);
    }

    const lookId = `look-${page_number}`;
    // Strict reference validation: must look like a real SKU code (alphanumeric,
    // contains at least one digit, length >= 3, not a common word). Avoids the
    // AI hallucinating references when no SKU is printed on the page.
    const refRegex = /^[A-Za-z0-9][A-Za-z0-9._\-\/]{2,30}$/;
    const isValidReference = (raw: unknown) => {
      const s = String(raw ?? "").trim();
      if (!s) return false;
      if (!refRegex.test(s)) return false;
      if (!/[0-9]/.test(s)) return false; // SKUs always have at least one digit
      // Reject obvious non-references
      const lower = s.toLowerCase();
      const blacklist = ["look", "page", "pagina", "página", "ref", "sku", "n/a", "na", "none"];
      if (blacklist.includes(lower)) return false;
      return true;
    };

    const cleaned = products
      .filter((p) => isValidReference(p?.reference))
      .map((p, i) => ({
        reference: String(p.reference).trim(),
        description: String(p.description ?? ""),
        material: String(p.material ?? ""),
        colors: Array.isArray(p.colors) ? p.colors.map(String) : [],
        sizes: Array.isArray(p.sizes) ? p.sizes.map(String) : [],
        price: Number(p.price ?? 0) || 0,
        bbox: (() => {
          if (!Array.isArray(p.bbox) || p.bbox.length !== 4) return [0, 0, 1, 1];
          const nums = p.bbox.map((n: any) => Number(n));
          const ok = nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) && nums[2] > 0 && nums[3] > 0;
          return ok ? nums : [0, 0, 1, 1];
        })(),
        sort_order: page_number * 100 + i,
      }));

    let inserted = 0;
    let updated = 0;
    for (const p of cleaned) {
      // We don't crop the image on the server (CPU-heavy). The full page URL is
      // stored, plus a normalized bbox per image so the client can show only the
      // region nearest to each reference.
      const productImageUrl = pageUrl;
      const productBbox = cleaned.length === 1 ? [0, 0, 1, 1] : p.bbox;

      const { data: existing } = await admin
        .from("products")
        .select("id")
        .eq("brand_id", brand_id)
        .eq("reference", p.reference)
        .maybeSingle();

      if (existing) {
        // Append a new image (idempotent on (product_id, url)).
        const { count: existingCount } = await admin
          .from("product_images")
          .select("id", { count: "exact", head: true })
          .eq("product_id", existing.id);
        const { error: imgErr } = await admin
          .from("product_images")
          .upsert(
            {
              product_id: existing.id,
              url: productImageUrl,
              bbox: productBbox,
              page_number,
              position: existingCount ?? 0,
              page_image_path: pathForSign,
            },
            { onConflict: "product_id,url", ignoreDuplicates: true },
          );
        if (imgErr) throw imgErr;
        updated++;
      } else {
        const { data: created, error: insErr } = await admin.from("products").insert({
          brand_id,
          page_number,
          look_id: lookId,
          reference: p.reference,
          description: p.description,
          material: p.material,
          colors: p.colors,
          sizes: p.sizes,
          price: p.price,
          sort_order: p.sort_order,
        }).select("id").single();
        if (insErr) throw insErr;
        const { error: imgErr } = await admin.from("product_images").insert({
          product_id: created!.id,
          url: productImageUrl,
          bbox: productBbox,
          page_number,
          position: 0,
          page_image_path: pathForSign,
        });
        if (imgErr) throw imgErr;
        inserted++;
      }
    }

    // Mark page done and recount brand progress atomically.
    await admin
      .from("catalog_page_jobs")
      .update({ status: "done", error_message: null })
      .eq("brand_id", brand_id)
      .eq("page_number", page_number);
    await admin.rpc("recount_brand_progress", { _brand_id: brand_id });

    return json({ ok: true, inserted, updated, page_url: pageUrl });
  } catch (e) {
    console.error("process-catalog-page error:", e);
    // Best-effort: mark the job as errored so the client can resume it later.
    try {
      if (jobBrandId && jobPageNumber) {
        const admin2 = createClient(url, serviceKey, { auth: { persistSession: false } });
        await admin2
          .from("catalog_page_jobs")
          .update({
            status: "error",
            error_message: e instanceof Error ? e.message : "Unknown error",
          })
          .eq("brand_id", jobBrandId)
          .eq("page_number", jobPageNumber);
      }
    } catch (_) { /* ignore */ }
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}