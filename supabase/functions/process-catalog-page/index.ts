// Receives one rendered PDF page (image data URL) and extracts products via Lovable AI Vision.
// Stores the page image, persists products, and updates brand progress.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You analyze fashion catalog pages and extract every product visible.
Return STRICT JSON via the provided tool. For each product include reference (SKU/code), description (short), material, colors (array of strings), sizes (array like S, M, L, 38, 40), and price as a number (0 if unknown).
If a field is unknown, use empty string or empty array; price 0. Multiple products on the same page belong to the same look.`;

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
            },
            required: ["reference", "description", "material", "colors", "sizes", "price"],
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

    const { brand_id, page_number, image_base64, total_pages, is_first } = await req.json();
    if (!brand_id || !page_number || !image_base64) {
      return json({ error: "brand_id, page_number, image_base64 required" }, 400);
    }

    // Upload page image to storage
    const pageBytes = decodeBase64(image_base64);
    const pagePath = `${brand_id}/page-${String(page_number).padStart(4, "0")}.jpg`;
    const { error: upErr } = await admin.storage
      .from("catalog-pages")
      .upload(pagePath, pageBytes, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw upErr;
    const { data: pub } = admin.storage.from("catalog-pages").getPublicUrl(pagePath);
    const pageUrl = pub.publicUrl;

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
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image_base64}` } },
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
    const rows = products.map((p, i) => ({
      brand_id,
      page_number,
      look_id: lookId,
      reference: String(p.reference ?? ""),
      description: String(p.description ?? ""),
      material: String(p.material ?? ""),
      colors: Array.isArray(p.colors) ? p.colors.map(String) : [],
      sizes: Array.isArray(p.sizes) ? p.sizes.map(String) : [],
      price: Number(p.price ?? 0) || 0,
      image_url: pageUrl,
      sort_order: page_number * 100 + i,
    }));

    if (rows.length > 0) {
      const { error: insErr } = await admin.from("products").insert(rows);
      if (insErr) throw insErr;
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

    return json({ ok: true, count: rows.length, page_url: pageUrl });
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