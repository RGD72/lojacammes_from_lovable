// Sends an email to the admin when a new order is placed.
// Uses Resend if RESEND_API_KEY is configured; otherwise no-ops gracefully.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { order_id } = await req.json();
    if (!order_id) return json({ error: "order_id required" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: order, error: oErr } = await admin
      .from("orders")
      .select("id, client_name, total, created_at, brand_id")
      .eq("id", order_id)
      .single();
    if (oErr || !order) throw oErr ?? new Error("order not found");

    const { data: brand } = await admin.from("brands").select("name").eq("id", order.brand_id).single();
    const { data: items } = await admin
      .from("order_items")
      .select("reference, description, color, size, quantity, unit_price")
      .eq("order_id", order_id);

    // Find admin emails
    const { data: adminRoles } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const adminIds = (adminRoles ?? []).map((r) => r.user_id);
    const { data: adminProfiles } = await admin
      .from("profiles")
      .select("email")
      .in("id", adminIds.length ? adminIds : ["00000000-0000-0000-0000-000000000000"]);
    const recipients = (adminProfiles ?? []).map((p) => p.email).filter(Boolean);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey || recipients.length === 0) {
      console.log("Email skipped (no RESEND_API_KEY or no admin recipients).");
      return json({ ok: true, emailed: false });
    }

    const rows = (items ?? [])
      .map(
        (i) =>
          `<tr><td>${esc(i.reference)}</td><td>${esc(i.description)}</td><td>${esc(i.color)}</td><td>${esc(i.size)}</td><td style="text-align:right">${i.quantity}</td><td style="text-align:right">${money(i.unit_price)}</td><td style="text-align:right">${money(Number(i.unit_price) * Number(i.quantity))}</td></tr>`,
      )
      .join("");

    const html = `
      <div style="font-family:Georgia,serif;max-width:680px;margin:0 auto;color:#2d2418;background:#faf8f5;padding:32px;">
        <h2 style="margin:0 0 8px;letter-spacing:0.02em;">Novo pedido recebido</h2>
        <p style="margin:0 0 24px;color:#8b7355;">${esc(brand?.name ?? "")} — ${new Date(order.created_at).toLocaleString("pt-BR")}</p>
        <p><strong>Cliente:</strong> ${esc(order.client_name)}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;background:white;">
          <thead><tr style="background:#f0ebe3;text-align:left;">
            <th style="padding:8px">Ref</th><th style="padding:8px">Descrição</th><th style="padding:8px">Cor</th><th style="padding:8px">Tam</th><th style="padding:8px;text-align:right">Qtd</th><th style="padding:8px;text-align:right">Unit.</th><th style="padding:8px;text-align:right">Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="text-align:right;font-size:18px;margin-top:16px;"><strong>Total: ${money(order.total)}</strong></p>
      </div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Pedidos <onboarding@resend.dev>",
        to: recipients,
        subject: `Novo pedido — ${brand?.name ?? ""} — ${order.client_name}`,
        html,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("Resend error", resp.status, t);
      return json({ ok: false, error: "email send failed" }, 500);
    }
    return json({ ok: true, emailed: true });
  } catch (e) {
    console.error("notify-new-order error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function esc(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function money(n: number | string) {
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}