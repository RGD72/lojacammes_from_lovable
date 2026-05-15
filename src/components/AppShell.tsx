import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role, profileName, signOut } = useAuth();
  const loc = useLocation();

  const adminLinks = [
    { to: "/admin", label: "Vitrines" },
    { to: "/admin/clients", label: "Clientes" },
    { to: "/admin/orders", label: "Pedidos" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to={role === "admin" ? "/admin" : "/"} className="font-display text-2xl tracking-tight">
            Cammes.com.br
          </Link>
          <nav className="flex items-center gap-1">
            {role === "admin" &&
              adminLinks.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === "/admin"}
                  className={({ isActive }) =>
                    `px-4 py-2 text-sm tracking-editorial transition-colors ${
                      isActive ? "text-primary border-b border-primary" : "text-muted-foreground hover:text-foreground"
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            {role === "client" && (
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `px-4 py-2 text-sm tracking-editorial ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`
                }
              >
                Vitrines
              </NavLink>
            )}
            <div className="ml-4 flex items-center gap-3 pl-4 border-l border-border">
              <span className="text-sm text-muted-foreground hidden sm:inline">{profileName}</span>
              <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sair">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </nav>
        </div>
      </header>
      <main key={loc.pathname}>{children}</main>
      <footer className="border-t border-border mt-24 py-8 text-center text-xs tracking-editorial text-muted-foreground">
        Cammes.com.br
      </footer>
    </div>
  );
}