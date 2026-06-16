import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface InItem {
  product_id: string;
  color?: string;
  size?: string;
  quantity: number;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return json(401, { error: "Unauthorized" });
  const userId = claims.claims.sub as string;

  const admin = createClient(url, service);

  // Check active client
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id, name, email, active")
    .eq("id", userId)
    .maybeSingle();
  if (pErr || !profile?.active) return json(403, { error: "Cliente inativo" });

  type Payload = { brand_id?: string; items?: InItem[]; idempotency_key?: string };
  let parsed: Payload;
  try {
    parsed = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const brand_id = parsed.brand_id;
  const items = parsed.items;
  const idempotency_key = parsed.idempotency_key;
  if (!brand_id || typeof brand_id !== "string") return json(400, { error: "brand_id ausente" });
  if (!Array.isArray(items) || items.length === 0) return json(400, { error: "Pedido vazio" });
  if (items.length > 500) return json(400, { error: "Pedido excede 500 itens" });
  if (
    !idempotency_key ||
    typeof idempotency_key !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotency_key)
  ) {
    return json(400, { error: "idempotency_key inválida" });
  }

  // If this exact key was already submitted by this user, return the existing order.
  {
    const { data: existing } = await admin
      .from("orders")
      .select("id, created_at, total")
      .eq("user_id", userId)
      .eq("client_idempotency_key", idempotency_key)
      .maybeSingle();
    if (existing) {
      const { data: rows } = await admin
        .from("order_items")
        .select("product_id, reference, description, color, size, quantity, unit_price")
        .eq("order_id", existing.id);
      return json(200, {
        order_id: existing.id,
        created_at: existing.created_at,
        total: Number(existing.total),
        items: rows ?? [],
        deduplicated: true,
      });
    }
  }

  // Validate item shape
  const cleaned: InItem[] = [];
  for (const it of items) {
    if (!it || typeof it.product_id !== "string") return json(400, { error: "Item inválido" });
    const q = Number(it.quantity);
    if (!Number.isFinite(q) || q < 1 || q > 9999) return json(400, { error: "Quantidade inválida" });
    cleaned.push({
      product_id: it.product_id,
      color: typeof it.color === "string" ? it.color : "",
      size: typeof it.size === "string" ? it.size : "",
      quantity: Math.floor(q),
    });
  }

  // Fetch products server-side
  const ids = Array.from(new Set(cleaned.map((i) => i.product_id)));
  const { data: products, error: prodErr } = await admin
    .from("products")
    .select("id, brand_id, reference, description, price, colors, sizes")
    .in("id", ids);
  if (prodErr) return json(500, { error: "Falha ao carregar produtos" });

  const byId = new Map(products?.map((p) => [p.id, p]) ?? []);
  for (const it of cleaned) {
    const p = byId.get(it.product_id);
    if (!p) return json(400, { error: `Produto ${it.product_id} não encontrado` });
    if (p.brand_id !== brand_id) return json(400, { error: "Produto não pertence à marca" });
    if (p.colors?.length && it.color && !p.colors.includes(it.color)) {
      return json(400, { error: `Cor inválida em ${p.reference}` });
    }
    if (p.sizes?.length && it.size && !p.sizes.includes(it.size)) {
      return json(400, { error: `Tamanho inválido em ${p.reference}` });
    }
  }

  // Build rows with server-side prices
  let total = 0;
  const rows = cleaned.map((it) => {
    const p = byId.get(it.product_id)!;
    const unit_price = Number(p.price);
    total += unit_price * it.quantity;
    return {
      product_id: p.id,
      reference: p.reference,
      description: p.description,
      color: it.color ?? "",
      size: it.size ?? "",
      quantity: it.quantity,
      unit_price,
    };
  });

  // Insert order
  const { data: order, error: oErr } = await admin
    .from("orders")
    .insert({
      brand_id,
      user_id: userId,
      client_name: profile.name || profile.email || "Cliente",
      status: "new",
      total,
      client_idempotency_key: idempotency_key,
    })
    .select()
    .single();
  if (oErr || !order) {
    // Lost the race against a concurrent retry with the same key — return that one.
    if ((oErr as { code?: string } | null)?.code === "23505") {
      const { data: existing } = await admin
        .from("orders")
        .select("id, created_at, total")
        .eq("user_id", userId)
        .eq("client_idempotency_key", idempotency_key)
        .maybeSingle();
      if (existing) {
        const { data: rows } = await admin
          .from("order_items")
          .select("product_id, reference, description, color, size, quantity, unit_price")
          .eq("order_id", existing.id);
        return json(200, {
          order_id: existing.id,
          created_at: existing.created_at,
          total: Number(existing.total),
          items: rows ?? [],
          deduplicated: true,
        });
      }
    }
    return json(500, { error: oErr?.message ?? "Falha ao criar pedido" });
  }

  const { error: iErr } = await admin
    .from("order_items")
    .insert(rows.map((r) => ({ ...r, order_id: order.id })));
  if (iErr) {
    await admin.from("orders").delete().eq("id", order.id);
    return json(500, { error: iErr.message });
  }

  // Notify admin (best-effort)
  admin.functions
    .invoke("notify-new-order", { body: { order_id: order.id } })
    .catch(() => {});

  return json(200, {
    order_id: order.id,
    created_at: order.created_at,
    total,
    items: rows,
  });
});