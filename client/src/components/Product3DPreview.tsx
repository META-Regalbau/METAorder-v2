/**
 * Product3DPreview - zeigt ein einzelnes GLB-Modell für ein Produkt
 * Nutzt glb-resolve API (productNumber / manufacturerNumber → cpq-models)
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Shelf3DScene from "./cpq/Shelf3DScene";

type Product3DPreviewProps = {
  productNumber: string;
  manufacturerNumber?: string | null;
  productId?: string;
  className?: string;
  canManageProducts?: boolean;
};

export default function Product3DPreview({
  productNumber,
  manufacturerNumber,
  productId = "product",
  className = "",
  canManageProducts = false,
}: Product3DPreviewProps) {
  const { toast } = useToast();
  const { data: glbData, isLoading } = useQuery<{ filename: string | null; url: string | null; mtime?: number | null }>({
    queryKey: ["/api/cpq/glb-resolve", productNumber, manufacturerNumber],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (productNumber) params.set("productNumber", productNumber);
      if (manufacturerNumber) params.set("manufacturerNumber", manufacturerNumber);
      if (params.toString().length === 0) return { filename: null, url: null };
      const res = await fetch(`/api/cpq/glb-resolve?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return { filename: null, url: null };
      return res.json();
    },
    enabled: !!(productNumber || manufacturerNumber),
  });

  const saveGlbMutation = useMutation({
    mutationFn: async () => {
      if (!productId || !glbData?.url) return;
      const fullUrl = glbData.url.startsWith("http") ? glbData.url : `${window.location.origin}${glbData.url.startsWith("/") ? glbData.url : `/${glbData.url}`}`;
      const res = await apiRequest("PATCH", `/api/products/${productId}/glb`, { glbUrl: fullUrl });
      return res.json();
    },
    onSuccess: () => {
      if (productId) {
        queryClient.invalidateQueries({ queryKey: ["/api/products", productId] });
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      }
      toast({ title: "GLB wurde in Shopware-Medien hochgeladen." });
    },
    onError: (err: Error) => {
      toast({ title: "Speichern fehlgeschlagen", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className={`aspect-square min-h-[160px] bg-muted rounded-md flex items-center justify-center text-muted-foreground text-sm ${className}`}>
        3D-Modell wird gesucht…
      </div>
    );
  }

  if (!glbData?.url) {
    return (
      <div className={`aspect-square min-h-[160px] bg-muted rounded-md flex flex-col items-center justify-center text-muted-foreground text-sm p-4 ${className}`}>
        <div>Kein 3D-Modell (GLB) vorhanden</div>
        <div className="text-xs mt-1">Produktnr. / Manufacturer Nr. für GLB-Match nutzen</div>
      </div>
    );
  }

  const glbUrl = glbData.mtime != null
    ? `${glbData.url}?v=${glbData.mtime}`
    : glbData.url;
  const components = [
    {
      productMappingId: productId,
      glbUrl,
      position: { x: 0, y: 0, z: 0 },
    },
  ];

  return (
    <div className={className}>
      <div className="relative">
        <Suspense
          fallback={
            <div className="aspect-square min-h-[160px] bg-muted rounded-md flex items-center justify-center text-muted-foreground text-sm">
              3D-Modell wird geladen…
            </div>
          }
        >
          <Shelf3DScene components={components} />
        </Suspense>
        {canManageProducts && productId && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-2 right-2 h-8 shadow-md"
            onClick={() => saveGlbMutation.mutate()}
            disabled={saveGlbMutation.isPending}
            title="GLB-URL in Shopware speichern"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saveGlbMutation.isPending ? "Speichern…" : "In Shopware speichern"}
          </Button>
        )}
      </div>
      <div className="px-2 py-1 text-xs text-muted-foreground text-center border-t mt-1 rounded-b-md bg-muted/30">
        GLB: {glbData.filename ?? "—"} · Schwenken & Zoomen mit Maus
      </div>
    </div>
  );
}
