import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SignedImg } from "@/lib/storage";

interface Brand { id: string; name: string; cover_image_url: string | null; }

export default function ClientHome() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("brands").select("id, name, cover_image_url").eq("status", "published").then(({ data }) => {
      setBrands((data ?? []) as Brand[]);
      setLoading(false);
    });
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <p className="tracking-editorial text-muted-foreground mb-2">Vitrines</p>
      <h1 className="font-display text-5xl mb-10">Coleções disponíveis</h1>
      {loading ? (
        <p className="text-muted-foreground">carregando…</p>
      ) : brands.length === 0 ? (
        <p className="text-muted-foreground">Nenhuma vitrine publicada no momento.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {brands.map((b) => (
            <Link key={b.id} to={`/brand/${b.id}`} className="group block">
              <div className="aspect-[3/4] bg-secondary overflow-hidden rounded">
                {b.cover_image_url ? (
                  <SignedImg
                    src={b.cover_image_url}
                    alt={b.name}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full" />
                )}
              </div>
              <h3 className="font-display text-2xl mt-3">{b.name}</h3>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}