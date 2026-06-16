import { createContext, useContext, useEffect, useState, ReactNode, useMemo } from "react";

export interface CartItem {
  product_id: string;
  reference: string;
  description: string;
  color: string;
  size: string;
  quantity: number;
  unit_price: number;
  image_url?: string;
}

type Carts = Record<string, CartItem[]>; // brand_id -> items

interface CartCtx {
  carts: Carts;
  addItem: (brandId: string, item: CartItem) => void;
  updateQty: (brandId: string, idx: number, qty: number) => void;
  removeItem: (brandId: string, idx: number) => void;
  clearBrand: (brandId: string) => void;
  countFor: (brandId: string) => number;
  totalFor: (brandId: string) => number;
  idempotencyKeyFor: (brandId: string) => string;
  rotateIdempotencyKey: (brandId: string) => void;
}

const Ctx = createContext<CartCtx>(null as unknown as CartCtx);
const KEY = "b2b_carts_v1";
const IKEY = "b2b_cart_idem_v1";

type IdemMap = Record<string, string>;

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch (_e) { /* ignore */ }
  // RFC4122 v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [carts, setCarts] = useState<Carts>({});
  const [idem, setIdem] = useState<IdemMap>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setCarts(JSON.parse(raw));
      const rawI = localStorage.getItem(IKEY);
      if (rawI) setIdem(JSON.parse(rawI));
    } catch (_e) { /* ignore */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(carts));
  }, [carts]);

  useEffect(() => {
    localStorage.setItem(IKEY, JSON.stringify(idem));
  }, [idem]);

  const value = useMemo<CartCtx>(() => ({
    carts,
    addItem: (brandId, item) =>
      setCarts((c) => {
        const list = c[brandId] ?? [];
        // merge if same product+color+size
        const idx = list.findIndex(
          (x) => x.product_id === item.product_id && x.color === item.color && x.size === item.size,
        );
        const next = [...list];
        if (idx >= 0) next[idx] = { ...next[idx], quantity: next[idx].quantity + item.quantity };
        else next.push(item);
        return { ...c, [brandId]: next };
      }),
    updateQty: (brandId, idx, qty) =>
      setCarts((c) => {
        const list = [...(c[brandId] ?? [])];
        if (!list[idx]) return c;
        list[idx] = { ...list[idx], quantity: Math.max(1, qty) };
        return { ...c, [brandId]: list };
      }),
    removeItem: (brandId, idx) =>
      setCarts((c) => {
        const list = [...(c[brandId] ?? [])];
        list.splice(idx, 1);
        return { ...c, [brandId]: list };
      }),
    clearBrand: (brandId) => setCarts((c) => ({ ...c, [brandId]: [] })),
    countFor: (brandId) =>
      (carts[brandId] ?? []).reduce((s, i) => s + i.quantity, 0),
    totalFor: (brandId) =>
      (carts[brandId] ?? []).reduce((s, i) => s + i.quantity * i.unit_price, 0),
    idempotencyKeyFor: (brandId) => {
      const existing = idem[brandId];
      if (existing) return existing;
      const k = uuid();
      setIdem((m) => ({ ...m, [brandId]: k }));
      return k;
    },
    rotateIdempotencyKey: (brandId) =>
      setIdem((m) => {
        const next = { ...m };
        delete next[brandId];
        return next;
      }),
  }), [carts, idem]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCart = () => useContext(Ctx);

export const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });