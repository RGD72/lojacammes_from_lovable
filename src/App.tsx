import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import Login from "./pages/Login.tsx";
import { AuthProvider } from "@/lib/auth";
import { CartProvider } from "@/lib/cart";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import AdminBrands from "./pages/admin/AdminBrands";
import AdminBrandEdit from "./pages/admin/AdminBrandEdit";
import AdminClients from "./pages/admin/AdminClients";
import AdminOrders from "./pages/admin/AdminOrders";
import ClientHome from "./pages/client/ClientHome";
import BrandShowcase from "./pages/client/BrandShowcase";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route
                path="/"
                element={
                  <ProtectedRoute requireRole="client">
                    <AppShell><ClientHome /></AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/brand/:id"
                element={
                  <ProtectedRoute requireRole="client">
                    <AppShell><BrandShowcase /></AppShell>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/admin"
                element={
                  <ProtectedRoute requireRole="admin">
                    <AppShell><AdminBrands /></AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/brands/:id"
                element={
                  <ProtectedRoute requireRole="admin">
                    <AppShell><AdminBrandEdit /></AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/brands/:id/preview"
                element={
                  <ProtectedRoute requireRole="admin">
                    <AppShell><BrandShowcase /></AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/clients"
                element={
                  <ProtectedRoute requireRole="admin">
                    <AppShell><AdminClients /></AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/orders"
                element={
                  <ProtectedRoute requireRole="admin">
                    <AppShell><AdminOrders /></AppShell>
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
