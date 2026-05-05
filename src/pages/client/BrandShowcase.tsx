import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Download, ShoppingBag } from "lucide-react";
import { useCart, money } from "@/lib/cart";
import { ProductDialog } from "@/components/ProductDialog";
import { CartDrawer } from "@/components/CartDrawer";

interface Brand { id: string; name: string; catalog_pdf_url: string | null; }
interface Product {
  id: string; brand_id: string; page_number: number; look_id: string;
  reference: string; description: string; material: string;
  colors: string[]; sizes: string[]; price: number; image_url: string | null;
  image_urls?: string[] | null;
}

export default function BrandShowcase() {
  const { id } = useParams<{ id: string }>();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const { countFor } = useCart();

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: b }, { data: p }] = await Promise.all([
        supabase.from("brands").select("id, name, catalog_pdf_url").eq("id", id).maybeSingle(),
        supabase.from("products").select("*").eq("brand_id", id).order("page_number").order("sort_order"),
      ]);
      setBrand((b ?? null) as Brand | null);
      setItems((p ?? []) as Product[]);
      setLoading(false);
    })();
  }, [id]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((x) =>
      [x.reference, x.description, x.material].some((f) => (f ?? "").toLowerCase().includes(term)),
    );
  }, [items, q]);

  const groups = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const it of filtered) {
      const key = it.look_id || `p-${it.page_number}`;
      const arr = m.get(key) ?? [];
      arr.push(it);
      m.set(key, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  if (loading) return <div className="p-12 text-muted-foreground">carregando…</div>;
  if (!brand) return <div className="p-12 text-muted-foreground">Vitrine não encontrada.</div>;

  const count = id ? countFor(id) : 0;

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Vitrines
      </Link>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <p className="tracking-editorial text-muted-foreground mb-2">Coleção</p>
          <h1 className="font-display text-5xl">{brand.name}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input placeholder="Buscar referência ou descrição…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          {brand.catalog_pdf_url && (
            <a href={brand.catalog_pdf_url} target="_blank" rel="noreferrer">
              <Button variant="outline"><Download className="h-4 w-4 mr-2" />Catálogo PDF</Button>
            </a>
          )}
          <Button onClick={() => setCartOpen(true)} className="relative">
            <ShoppingBag className="h-4 w-4 mr-2" /> Pedido
            {count > 0 && (
              <span className="ml-2 inline-flex items-center justify-center text-[11px] bg-background text-foreground rounded-full h-5 min-w-5 px-1.5">
                {count}
              </span>
            )}
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground">Nenhum produto encontrado.</p>
      ) : (
        <div className="space-y-12">
          {groups.map(([look, arr]) => (
            <section key={look}>
              <p className="tracking-editorial text-muted-foreground mb-3">Look {arr[0].page_number}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                {arr.map((p) => (
                  <button key={p.id} onClick={() => setActive(p)} className="text-left group">
                    <ProductGallery product={p} />
                    <div className="mt-2">
                      <p className="text-[10px] tracking-editorial text-muted-foreground">{p.reference || "—"}</p>
                      <p className="font-display text-lg leading-tight">{p.description || "Produto"}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{money(Number(p.price))}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ProductDialog product={active} brandId={brand.id} onClose={() => setActive(null)} />
      <CartDrawer open={cartOpen} onOpenChange={setCartOpen} brand={brand} />
    </div>
  );
}