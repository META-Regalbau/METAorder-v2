import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X, Package, Euro, Info, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";
import type { Product, CrossSellingGroup, User } from "@shared/schema";
import CrossSellingManager from "./CrossSellingManager";

interface ProductDetailModalProps {
  product: Product | null;
  open: boolean;
  onClose: () => void;
}

export default function ProductDetailModal({
  product,
  open,
  onClose,
}: ProductDetailModalProps) {
  const { t } = useTranslation();
  const [showCrossSellingManager, setShowCrossSellingManager] = useState(false);

  // Get current user to check role
  const { data: userData } = useQuery<{ user: User }>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  const { data: crossSellingData, refetch: refetchCrossSelling } = useQuery<{
    crossSellings: CrossSellingGroup[];
  }>({
    queryKey: ["/api/products", product?.id, "cross-selling"],
    queryFn: async () => {
      if (!product) throw new Error("No product");
      const response = await fetch(`/api/products/${product.id}/cross-selling`);
      if (!response.ok) throw new Error("Failed to fetch cross-selling");
      return response.json();
    },
    enabled: !!product && open,
  });

  if (!product) return null;

  const crossSellings = crossSellingData?.crossSellings || [];
  const totalCrossSellingProducts = crossSellings.reduce(
    (sum, cs) => sum + (cs.products?.length || 0),
    0
  );
  
  // Check if user is admin
  const isAdmin = userData?.user?.role === 'admin';

  return (
    <>
      <Dialog open={open && !showCrossSellingManager} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {product.name}
            </DialogTitle>
            <DialogDescription>
              {t("crossSelling.productDetails")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Product Image */}
            {product.imageUrl && (
              <div className="aspect-video bg-muted rounded-md overflow-hidden">
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="w-full h-full object-cover"
                  data-testid={`img-product-detail-${product.id}`}
                />
              </div>
            )}

            {/* Product Info Grid */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-3">
                <p className="text-xs text-muted-foreground">
                  {t("products.productNumber")}
                </p>
                <p className="font-mono font-medium" data-testid="text-product-number">
                  {product.productNumber}
                </p>
              </Card>

              <Card className="p-3">
                <p className="text-xs text-muted-foreground">
                  {t("products.price")}
                </p>
                <div className="space-y-1">
                  <p className="font-bold text-lg" data-testid="text-price-net">
                    €{product.netPrice.toFixed(2)} <span className="text-xs font-normal text-muted-foreground">{t('orderDetail.net')}</span>
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="text-price-gross">
                    €{product.price.toFixed(2)} <span className="text-xs">{t('orderDetail.gross')}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('orderDetail.taxRate')}: {product.taxRate}%
                  </p>
                </div>
              </Card>

              <Card className="p-3">
                <p className="text-xs text-muted-foreground">
                  {t("products.stock")}
                </p>
                <p className="font-medium" data-testid="text-stock">
                  {product.stock} {product.packagingUnit || t("products.unit")}
                </p>
              </Card>

              <Card className="p-3">
                <p className="text-xs text-muted-foreground">
                  {t("products.availability")}
                </p>
                <Badge
                  variant={product.available ? "default" : "secondary"}
                  data-testid="badge-availability"
                >
                  {product.available
                    ? t("products.available")
                    : t("products.notAvailable")}
                </Badge>
              </Card>
            </div>

            {/* Dimensions */}
            {product.dimensions && (
              <Card className="p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  {t("products.dimensions")}
                </p>
                <div className="flex gap-4 text-sm">
                  {product.dimensions.height && (
                    <div>
                      <span className="text-muted-foreground">
                        {t("products.height")}:
                      </span>{" "}
                      <span className="font-medium">
                        {product.dimensions.height} {product.dimensions.unit || "cm"}
                      </span>
                    </div>
                  )}
                  {product.dimensions.width && (
                    <div>
                      <span className="text-muted-foreground">
                        {t("products.width")}:
                      </span>{" "}
                      <span className="font-medium">
                        {product.dimensions.width} {product.dimensions.unit || "cm"}
                      </span>
                    </div>
                  )}
                  {product.dimensions.length && (
                    <div>
                      <span className="text-muted-foreground">
                        {t("products.depth")}:
                      </span>{" "}
                      <span className="font-medium">
                        {product.dimensions.length} {product.dimensions.unit || "cm"}
                      </span>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Description */}
            {product.description && (
              <Card className="p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  {t("products.description")}
                </p>
                <p className="text-sm">{product.description}</p>
              </Card>
            )}

            <Separator />

            {/* Cross-Selling Section */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">{t("crossSelling.title")}</h3>
                  {totalCrossSellingProducts > 0 && (
                    <Badge variant="secondary">
                      {totalCrossSellingProducts}{" "}
                      {t("crossSelling.productsLinked")}
                    </Badge>
                  )}
                </div>
                {isAdmin && (
                  <Button
                    onClick={() => setShowCrossSellingManager(true)}
                    variant="outline"
                    size="sm"
                    data-testid="button-manage-cross-selling"
                  >
                    {t("crossSelling.manage")}
                  </Button>
                )}
              </div>

              {crossSellings.length === 0 ? (
                <Card className="p-6 text-center">
                  <Info className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {t("crossSelling.noLinkedProducts")}
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {crossSellings.map((cs) => (
                    <Card key={cs.id} className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium text-sm">{cs.name}</h4>
                        <Badge variant="outline" className="text-xs">
                          {cs.products?.length || 0}{" "}
                          {t("crossSelling.products")}
                        </Badge>
                      </div>
                      {cs.products && cs.products.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {cs.products.slice(0, 5).map((p) => (
                            <Badge
                              key={p.id}
                              variant="secondary"
                              className="text-xs"
                            >
                              {p.productNumber}
                            </Badge>
                          ))}
                          {cs.products.length > 5 && (
                            <Badge variant="secondary" className="text-xs">
                              +{cs.products.length - 5} {t("common.more")}
                            </Badge>
                          )}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cross-Selling Manager Modal */}
      {showCrossSellingManager && (
        <CrossSellingManager
          product={product}
          open={showCrossSellingManager}
          onClose={() => {
            setShowCrossSellingManager(false);
            refetchCrossSelling();
          }}
        />
      )}
    </>
  );
}
