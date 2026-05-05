import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, Eye } from "lucide-react";

type Status = "new" | "viewed" | "confirmed" | "paid" | "cancelled";

interface Order {
  id: string;
  brand_id: string;
  user_id: string;
  client_name: string;
  status: Status;
  total: number;
  created_at: string;
}
interface Brand { id: string; name: string; commission_pct: number; }
interface OrderItem {
  id: string; order_id: string; reference: string; description: string;
  color: string; size: string; quantity: number; unit_price: number;
}
interface ProfilePhone { id: string; phone: string | null; }

const statusLabel: Record<Status, string> = {
  new: "Novo", viewed: "Visualizado", confirmed: "Confirmado", paid: "Pago", cancelled: "Cancelado",
};
const money = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [allItems, setAllItems] = useState<OrderItem[]>([]);
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewing, setViewing] = useState<Order | null>(null);

  const load = async () => {
    const [{ data: o }, { data: b }] = await Promise.all([
      supabase.from("orders").select("*").order("created_at", { ascending: false }),
      supabase.from("brands").select("id, name, commission_pct").order("name"),
    ]);
    const ords = (o ?? []) as Order[];
    setOrders(ords);
    setBrands((b ?? []) as Brand[]);
    if (ords.length) {
      const ids = ords.map((x) => x.id);
      const userIds = Array.from(new Set(ords.map((x) => x.user_id)));
      const [{ data: its }, { data: profs }] = await Promise.all([
        supabase.from("order_items").select("*").in("order_id", ids),
        supabase.from("profiles").select("id, phone").in("id", userIds),
      ]);
      setAllItems((its ?? []) as OrderItem[]);
      const map: Record<string, string> = {};
      for (const p of (profs ?? []) as ProfilePhone[]) map[p.id] = p.phone ?? "";
      setPhones(map);
    } else {
      setAllItems([]);
      setPhones({});
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (brandFilter !== "all" && o.brand_id !== brandFilter) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (dateFrom && new Date(o.created_at) < new Date(dateFrom)) return false;
      if (dateTo) {
        const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
        if (new Date(o.created_at) > end) return false;
      }
      return true;
    });
  }, [orders, brandFilter, statusFilter, dateFrom, dateTo]);

  const rowList = useMemo(() => {
    const list: { order: Order; item: OrderItem }[] = [];
    for (const o of filteredOrders) {
      const its = allItems.filter((i) => i.order_id === o.id);
      for (const i of its) list.push({ order: o, item: i });
    }
    return list;
  }, [filteredOrders, allItems]);

  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? "—";
  const brandCommission = (id: string) => Number(brands.find((b) => b.id === id)?.commission_pct ?? 0);

  const updateStatus = async (o: Order, status: Status) => {
    const { error } = await supabase.from("orders").update({ status }).eq("id", o.id);
    if (error) toast.error(error.message);
    else toast.success("Status atualizado");
  };

  const exportCsv = async () => {
    if (rowList.length === 0) return toast.error("Nenhum pedido para exportar");
    const lines: string[] = [];
    lines.push(["Data","Cliente","Telefone","Vitrine","Ref","Descrição","Cor","Tam","Qtd","Valor Unit.","Total","Total Com Comissão","Status"].join(";"));
    for (const { order: o, item: i } of rowList) {
      const total = Number(i.unit_price) * Number(i.quantity);
      const totalC = total * (1 + brandCommission(o.brand_id) / 100);
      lines.push([
        new Date(o.created_at).toLocaleString("pt-BR"),
        csv(o.client_name),
        csv(phones[o.user_id] ?? ""),
        csv(brandName(o.brand_id)),
        csv(i.reference),
        csv(i.description),
        csv(i.color),
        csv(i.size),
        i.quantity,
        money(Number(i.unit_price)),
        money(total),
        money(totalC),
        statusLabel[o.status],
      ].join(";"));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pedidos-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
        <div>
          <p className="tracking-editorial text-muted-foreground mb-2">Painel</p>
          <h1 className="font-display text-5xl">Pedidos</h1>
        </div>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="h-4 w-4 mr-2" /> Exportar CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger><SelectValue placeholder="Vitrine" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as vitrines</SelectItem>
            {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {(Object.keys(statusLabel) as Status[]).map((s) => (
              <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-muted-foreground">carregando…</p>
      ) : rowList.length === 0 ? (
        <p className="text-muted-foreground">Nenhum pedido encontrado.</p>
      ) : (
        <div className="bg-card border border-border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60">
              <tr className="text-left">
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Data</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Cliente</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Telefone</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Vitrine</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Ref</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Descrição</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Cor</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Tam</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground text-right">Qtd</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground text-right">Valor Unit.</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground text-right">Total</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground text-right">Total c/ Comissão</th>
                <th className="px-4 py-3 tracking-editorial text-[10px] text-muted-foreground">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rowList.map(({ order: o, item: i }) => {
                const total = Number(i.unit_price) * Number(i.quantity);
                const totalC = total * (1 + brandCommission(o.brand_id) / 100);
                return (
                  <tr key={i.id} className="border-t border-border">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{new Date(o.created_at).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3">{o.client_name}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{phones[o.user_id] ?? "—"}</td>
                    <td className="px-4 py-3">{brandName(o.brand_id)}</td>
                    <td className="px-4 py-3">{i.reference}</td>
                    <td className="px-4 py-3">{i.description}</td>
                    <td className="px-4 py-3">{i.color}</td>
                    <td className="px-4 py-3">{i.size}</td>
                    <td className="px-4 py-3 text-right">{i.quantity}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{money(Number(i.unit_price))}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{money(total)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{money(totalC)}</td>
                    <td className="px-4 py-3">
                      <Select value={o.status} onValueChange={(v) => updateStatus(o, v as Status)}>
                        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(statusLabel) as Status[]).map((s) => (
                            <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => {
                        setViewing(o);
                        if (o.status === "new") updateStatus(o, "viewed");
                      }}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <OrderDetail order={viewing} brandName={viewing ? brandName(viewing.brand_id) : ""} onClose={() => setViewing(null)} />
    </div>
  );
}

function csv(s: string) {
  const v = String(s ?? "").replace(/"/g, '""');
  return /[;"\n]/.test(v) ? `"${v}"` : v;
}

function OrderDetail({ order, brandName, onClose }: { order: Order | null; brandName: string; onClose: () => void }) {
  const [items, setItems] = useState<OrderItem[]>([]);
  useEffect(() => {
    if (!order) return;
    supabase.from("order_items").select("*").eq("order_id", order.id).then(({ data }) => {
      setItems((data ?? []) as OrderItem[]);
    });
  }, [order]);
  if (!order) return null;
  return (
    <Dialog open={!!order} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Pedido {order.id.slice(0, 8)}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-4">
          {brandName} · {order.client_name} · {new Date(order.created_at).toLocaleString("pt-BR")}
        </div>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left">
              <tr>
                <th className="px-3 py-2 text-[10px] tracking-editorial text-muted-foreground">Ref</th>
                <th className="px-3 py-2 text-[10px] tracking-editorial text-muted-foreground">Descrição</th>
                <th className="px-3 py-2 text-[10px] tracking-editorial text-muted-foreground">Cor</th>
                <th className="px-3 py-2 text-[10px] tracking-editorial text-muted-foreground">Tam</th>
                <th className="px-3 py-2 text-[10px] tracking-editorial text-muted-foreground text-right">Qtd</th>
                <th className="px-3 py-2 text-[10px] tracking-editorial text-muted-foreground text-right">Unit.</th>
                <th className="px-3 py-2 text-[10px] tracking-editorial text-muted-foreground text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="px-3 py-2">{i.reference}</td>
                  <td className="px-3 py-2">{i.description}</td>
                  <td className="px-3 py-2">{i.color}</td>
                  <td className="px-3 py-2">{i.size}</td>
                  <td className="px-3 py-2 text-right">{i.quantity}</td>
                  <td className="px-3 py-2 text-right">{money(Number(i.unit_price))}</td>
                  <td className="px-3 py-2 text-right">{money(Number(i.unit_price) * i.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-right font-display text-2xl mt-4">Total {money(Number(order.total))}</p>
      </DialogContent>
    </Dialog>
  );
}