import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export function ProtectedRoute({
  children,
  requireRole,
}: {
  children: React.ReactNode;
  requireRole?: "admin" | "client";
}) {
  const { user, role, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground tracking-editorial">
        carregando…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (requireRole && role !== requireRole) {
    return <Navigate to={role === "admin" ? "/admin" : "/"} replace />;
  }
  return <>{children}</>;
}