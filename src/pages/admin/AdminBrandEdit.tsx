import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Trash2, ArrowLeft, Save } from "lucide-react";

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
}

export default function AdminBrandEdit() {
  const { id } = useParams<{ id: string }>();
  const [brandName, setBrandName] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!id) return;
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase.from("brands").select("name").eq("id", id).maybeSingle(),
      supabase.from("products").select("*").eq("brand_id", id).order("sort_order"),
    ]);
    setBrandName(b?.name ?? "");
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
      <Link to="/admin" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Vitrines
      </Link>
      <h1 className="font-display text-4xl mb-8">{brandName}</h1>
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

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] tracking-editorial text-muted-foreground">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
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
        {draft.image_url && (
          <img src={draft.image_url} alt="" className="w-full aspect-square object-cover rounded" />
        )}
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
        <Field
          label="Cores (vírgula)"
          value={draft.colors.join(", ")}
          onChange={(v) => setDraft({ ...draft, colors: v.split(",").map((x) => x.trim()).filter(Boolean) })}
        />
        <Field
          label="Tamanhos (vírgula)"
          value={draft.sizes.join(", ")}
          onChange={(v) => setDraft({ ...draft, sizes: v.split(",").map((x) => x.trim()).filter(Boolean) })}
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