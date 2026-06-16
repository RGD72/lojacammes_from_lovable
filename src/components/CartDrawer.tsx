import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Download } from "lucide-react";
import { useCart, money } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { generateOrderPdf } from "@/lib/orderPdf";
import { SignedImg } from "@/lib/storage";

interface Brand { id: string; name: string; }

export function CartDrawer({
  open, onOpenChange, brand,
}: { open: boolean; onOpenChange: (v: boolean) => void; brand: Brand }) {
  const { carts, updateQty, removeItem, totalFor, clearBrand, idempotencyKeyFor, rotateIdempotencyKey } = useCart();
  const { user, profileName } = useAuth();
  const items = carts[brand.id] ?? [];
  const total = totalFor(brand.id);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<
    { id: string; createdAt: string; items: typeof items; total: number } | null
  >(null);

  const submit = async () => {
    if (!user) return toast.error("Sessão expirada");
    if (items.length === 0) return toast.error("Pedido vazio");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-order", {
        body: {
          brand_id: brand.id,
          idempotency_key: idempotencyKeyFor(brand.id),
          items: items.map((i) => ({
            product_id: i.product_id,
            color: i.color,
            size: i.size,
            quantity: i.quantity,
          })),
        },
      });
      if (error) throw error;
      if (!data?.order_id) throw new Error(data?.error ?? "Falha ao criar pedido");

      // Merge server-recalculated prices back into local items for the receipt PDF
      const serverRows: Array<{ product_id: string; color: string; size: string; unit_price: number }> =
        data.items ?? [];
      const priced = items.map((i) => {
        const match = serverRows.find(
          (r) => r.product_id === i.product_id && r.color === (i.color ?? "") && r.size === (i.size ?? ""),
        );
        return match ? { ...i, unit_price: Number(match.unit_price) } : i;
      });

      setConfirmation({
        id: data.order_id,
        createdAt: data.created_at,
        items: priced,
        total: Number(data.total),
      });
      clearBrand(brand.id);
      rotateIdempotencyKey(brand.id);
      toast.success("Pedido enviado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar");
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = () => {
    if (!confirmation) return;
    generateOrderPdf({
      orderId: confirmation.id,
      brandName: brand.name,
      clientName: profileName || user?.email || "",
      createdAt: confirmation.createdAt,
      items: confirmation.items,
      total: confirmation.total,
    });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setConfirmation(null); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-3xl">
            {confirmation ? "Pedido enviado" : `Pedido — ${brand.name}`}
          </SheetTitle>
        </SheetHeader>

        {confirmation ? (
          <div className="mt-6 space-y-4">
            <p className="text-muted-foreground">
              Seu pedido foi registrado. Identificador: <span className="font-mono text-xs">{confirmation.id.slice(0, 8)}</span>.
            </p>
            <Button onClick={downloadPdf} variant="outline">
              <Download className="h-4 w-4 mr-2" /> Baixar pedido em PDF
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="mt-6 text-muted-foreground">Nenhum item selecionado.</p>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="space-y-3">
              {items.map((i, idx) => (
                <div key={idx} className="flex items-center gap-3 border-b border-border pb-3">
                  {i.image_url && <SignedImg src={i.image_url} alt="" className="w-14 h-14 object-cover rounded" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] tracking-editorial text-muted-foreground">{i.reference}</p>
                    <p className="font-display text-lg leading-tight truncate">{i.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {[i.color, i.size].filter(Boolean).join(" · ")} · {money(i.unit_price)}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    value={i.quantity}
                    onChange={(e) => updateQty(brand.id, idx, Number(e.target.value) || 1)}
                    className="w-16"
                  />
                  <p className="w-24 text-right text-sm">{money(i.unit_price * i.quantity)}</p>
                  <Button variant="ghost" size="icon" onClick={() => removeItem(brand.id, idx)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-end justify-between pt-2">
              <p className="text-sm text-muted-foreground">Cliente: {profileName || user?.email}</p>
              <p className="font-display text-2xl">Total {money(total)}</p>
            </div>

            <Button className="w-full" onClick={submit} disabled={busy}>
              {busy ? "Enviando…" : "Enviar pedido"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}