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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

    const { brand_id, page_number, page_url, total_pages, is_first } = await req.json();
    if (!brand_id || !page_number || !page_url) {
      return json({ error: "brand_id, page_number, page_url required" }, 400);
    }
    const pageUrl: string = page_url;

    // First page becomes the cover
    if (is_first) {
      await admin.from("brands").update({
        cover_image_url: pageUrl,
        total_pages: total_pages ?? null,
      }).eq("id", brand_id);
    }

    // Call Lovable AI gateway with vision + tool calling
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Extract all products visible on page ${page_number}.` },
              { type: "image_url", image_url: { url: pageUrl } },
            ],
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "extract_products" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI error", aiResp.status, t);
      if (aiResp.status === 429) return json({ error: "AI rate limit exceeded, try again later." }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted. Add funds to your workspace." }, 402);
      return json({ error: "AI gateway error" }, 500);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    let products: any[] = [];
    if (toolCall?.function?.arguments) {
      try {
        products = JSON.parse(toolCall.function.arguments).products ?? [];
      } catch (e) {
        console.error("parse tool args failed", e);
      }
    }

    const lookId = `look-${page_number}`;
    const cleaned = products
      .filter((p) => String(p?.reference ?? "").trim().length > 0)
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
        .select("id, image_urls, image_url, image_bboxes")
        .eq("brand_id", brand_id)
        .eq("reference", p.reference)
        .maybeSingle();

      if (existing) {
        const current: string[] = Array.isArray(existing.image_urls) ? existing.image_urls : [];
        const currentBoxes: number[][] = Array.isArray(existing.image_bboxes)
          ? (existing.image_bboxes as number[][])
          : [];
        if (!current.includes(productImageUrl)) {
          const next = [...current, productImageUrl];
          const nextBoxes = [...currentBoxes, productBbox];
          await admin
            .from("products")
            .update({ image_urls: next, image_bboxes: nextBoxes })
            .eq("id", existing.id);
          updated++;
        }
      } else {
        const { error: insErr } = await admin.from("products").insert({
          brand_id,
          page_number,
          look_id: lookId,
          reference: p.reference,
          description: p.description,
          material: p.material,
          colors: p.colors,
          sizes: p.sizes,
          price: p.price,
          image_url: productImageUrl,
          image_urls: [productImageUrl],
          image_bboxes: [productBbox],
          sort_order: p.sort_order,
        });
        if (insErr) throw insErr;
        inserted++;
      }
    }

    // Update progress
    const { data: brand } = await admin
      .from("brands")
      .select("processed_pages")
      .eq("id", brand_id)
      .single();
    const newProcessed = (brand?.processed_pages ?? 0) + 1;
    const updates: Record<string, unknown> = { processed_pages: newProcessed };
    if (total_pages && newProcessed >= total_pages) {
      updates.status = "unpublished"; // ready for review
    }
    await admin.from("brands").update(updates).eq("id", brand_id);

    return json({ ok: true, inserted, updated, page_url: pageUrl });
  } catch (e) {
    console.error("process-catalog-page error:", e);
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