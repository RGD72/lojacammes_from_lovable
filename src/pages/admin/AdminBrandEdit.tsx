import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Trash2, ArrowLeft, Save, LogOut } from "lucide-react";
import { SignedImg } from "@/lib/storage";
import { BboxEditor } from "@/components/admin/BboxEditor";

interface Product {
  id: string;
  page_number: number;
  look_id: string;
  reference: string;
  description: string;
  material: string;
  colors: string[];
  sizes: string[];
  price: number;
  image_url: string | null;
  product_images?: {
    id: string;
    url: string;
    position: number;
    bbox: number[] | null;
    page_image_path: string | null;
  }[] | null;
}

export default function AdminBrandEdit() {
  const { id } = useParams<{ id: string }>();
  const [brandName, setBrandName] = useState("");
  const [commissionPct, setCommissionPct] = useState<number>(30);
  const [savingCommission, setSavingCommission] = useState(false);
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!id) return;
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase.from("brands").select("name, commission_pct").eq("id", id).maybeSingle(),
      supabase
        .from("products")
        .select("*, product_images(id, url, position, bbox, page_image_path)")
        .eq("brand_id", id)
        .order("sort_order"),
    ]);
    setBrandName(b?.name ?? "");
    setCommissionPct(Number((b as { commission_pct?: number } | null)?.commission_pct ?? 30));
    setItems((p ?? []) as Product[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);

  const remove = async (pid: string) => {
    if (!confirm("Remover este produto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", pid);
    if (error) toast.error(error.message);
    else setItems((s) => s.filter((x) => x.id !== pid));
  };

  if (loading) return <div className="p-12 text-muted-foreground">carregando…</div>;

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-4">
        <Link to="/admin" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Vitrines
        </Link>
        <Link to="/admin">
          <Button variant="outline" size="sm">
            <LogOut className="h-4 w-4 mr-1" /> Sair da edição
          </Button>
        </Link>
      </div>
      <h1 className="font-display text-4xl mb-6">{brandName}</h1>
      <div className="bg-card border border-border rounded p-4 mb-6 flex items-end gap-3 max-w-md">
        <div className="flex-1 space-y-1">
          <label className="text-[10px] tracking-editorial text-muted-foreground">Comissão (%)</label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={commissionPct}
            onChange={(e) => setCommissionPct(Number(e.target.value) || 0)}
          />
        </div>
        <Button
          size="sm"
          disabled={savingCommission}
          onClick={async () => {
            if (!id) return;
            setSavingCommission(true);
            const { error } = await supabase
              .from("brands")
              .update({ commission_pct: commissionPct } as never)
              .eq("id", id);
            setSavingCommission(false);
            if (error) toast.error(error.message);
            else toast.success("Comissão salva");
          }}
        >
          <Save className="h-4 w-4" />
          {savingCommission ? "Salvando…" : "Salvar"}
        </Button>
      </div>
      <div className="space-y-3">
        {items.map((p) => (
          <ProductRow
            key={p.id}
            product={p}
            onSaved={(updated) =>
              setItems((s) => s.map((x) => (x.id === updated.id ? updated : x)))
            }
            onRemove={() => remove(p.id)}
          />
        ))}
        {items.length === 0 && (
          <p className="text-muted-foreground">Nenhum produto extraído ainda.</p>
        )}
      </div>
    </div>
  );
}

type PI = NonNullable<Product["product_images"]>[number];

function isSuspect(bbox: number[] | null | undefined): boolean {
  if (!Array.isArray(bbox) || bbox.length !== 4) return true;
  const [x, y, w, h] = bbox;
  if (![x, y, w, h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return true;
  if (w * h < 0.05) return true;
  if (x === 0 && y === 0 && w === 1 && h === 1) return true;
  return false;
}

function ProductThumbs({
  product,
  onUpdated,
}: {
  product: Product;
  onUpdated: (images: PI[]) => void;
}) {
  const images = (product.product_images ?? [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const [editing, setEditing] = useState<PI | null>(null);

  if (images.length === 0) {
    return product.image_url ? (
      <SignedImg src={product.image_url} alt="" className="w-full aspect-square object-cover rounded" />
    ) : (
      <div className="w-full aspect-square bg-secondary rounded" />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-1">
        {images.map((img) => {
          const suspect = isSuspect(img.bbox);
          return (
            <div key={img.id} className="relative group">
              <SignedImg
                src={img.url}
                alt=""
                className="w-full aspect-square object-cover rounded"
              />
              {suspect && (
                <span className="absolute top-0.5 left-0.5 text-[9px] bg-destructive text-destructive-foreground px-1 rounded">
                  ⚠ recorte
                </span>
              )}
              <button
                type="button"
                onClick={() => setEditing(img)}
                disabled={!img.page_image_path}
                title={img.page_image_path ? "Ajustar recorte" : "Sem página de origem"}
                className="absolute inset-0 bg-background/0 hover:bg-background/60 text-[10px] tracking-editorial uppercase opacity-0 hover:opacity-100 transition disabled:cursor-not-allowed"
              >
                Ajustar
              </button>
            </div>
          );
        })}
      </div>
      {editing && editing.page_image_path && (
        <BboxEditor
          open={!!editing}
          onClose={() => setEditing(null)}
          productImageId={editing.id}
          pagePath={editing.page_image_path}
          initialBbox={
            (Array.isArray(editing.bbox) && editing.bbox.length === 4
              ? (editing.bbox as [number, number, number, number])
              : [0, 0, 1, 1]) as [number, number, number, number]
          }
          siblings={images
            .filter((s) => s.id !== editing.id && Array.isArray(s.bbox) && s.bbox.length === 4)
            .map((s) => ({
              id: s.id,
              bbox: s.bbox as [number, number, number, number],
            }))}
          onSaved={(nb) => {
            const next = images.map((i) =>
              i.id === editing.id ? { ...i, bbox: nb as number[] } : i,
            );
            onUpdated(next);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] tracking-editorial text-muted-foreground">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (arr: string[]) => void;
}) {
  const [text, setText] = useState(value.join(", "));
  const externalKey = value.join("|");
  useEffect(() => {
    const parsed = text.split(",").map((x) => x.trim()).filter(Boolean);
    if (parsed.join("|") !== externalKey) {
      setText(value.join(", "));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalKey]);
  return (
    <div className="space-y-1">
      <label className="text-[10px] tracking-editorial text-muted-foreground">{label}</label>
      <Input
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          onChange(v.split(",").map((x) => x.trim()).filter(Boolean));
        }}
      />
    </div>
  );
}

function ProductRow({
  product,
  onSaved,
  onRemove,
}: {
  product: Product;
  onSaved: (p: Product) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<Product>(product);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(product), [product]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(product);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("products")
      .update({
        reference: draft.reference,
        description: draft.description,
        material: draft.material,
        colors: draft.colors,
        sizes: draft.sizes,
        price: draft.price,
      })
      .eq("id", draft.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Alterações salvas");
      onSaved(draft);
    }
  };

  return (
    <div className="bg-card border border-border rounded p-4 grid grid-cols-12 gap-3 items-start">
      <div className="col-span-2">
        <ProductThumbs
          product={draft}
          onUpdated={(images) => {
            const next = { ...draft, product_images: images };
            setDraft(next);
            onSaved(next);
          }}
        />
        <p className="text-[10px] tracking-editorial text-muted-foreground mt-1">Look {draft.page_number}</p>
      </div>
      <div className="col-span-10 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Referência" value={draft.reference} onChange={(v) => setDraft({ ...draft, reference: v })} />
        <Field label="Descrição" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
        <Field label="Material" value={draft.material} onChange={(v) => setDraft({ ...draft, material: v })} />
        <Field
          label="Preço"
          value={String(draft.price)}
          onChange={(v) => setDraft({ ...draft, price: Number(v) || 0 })}
        />
        <ListField
          label="Cores (vírgula)"
          value={draft.colors}
          onChange={(arr) => setDraft({ ...draft, colors: arr })}
        />
        <ListField
          label="Tamanhos (vírgula)"
          value={draft.sizes}
          onChange={(arr) => setDraft({ ...draft, sizes: arr })}
        />
        <div className="flex items-end justify-end gap-2 col-span-2 lg:col-span-4">
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            <Save className="h-4 w-4" />
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}