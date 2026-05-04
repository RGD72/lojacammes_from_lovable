import { useParams } from "react-router-dom";
export default function BrandShowcase() {
  const { id } = useParams();
  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <h1 className="font-display text-4xl mb-2">Vitrine</h1>
      <p className="text-muted-foreground">Vitrine {id} — em construção (Fase 3 e 4).</p>
    </div>
  );
}