import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEffect, useMemo, useState } from "react";
import type { Product, CrossSellingGroup, User, Role } from "@shared/schema";
import CrossSellingManager from "./CrossSellingManager";
import Product3DPreview from "./Product3DPreview";
import { CategoryMultiSelect } from "@/components/CategoryMultiSelect";
import { SalesChannelSelector } from "@/components/SalesChannelSelector";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();
  const [showCrossSellingManager, setShowCrossSellingManager] = useState(false);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [salesChannelIds, setSalesChannelIds] = useState<string[]>([]);
  const [pluginWarning, setPluginWarning] = useState(false);
  const dataQualityColors = [
    "#60a5fa",
    "#38bdf8",
    "#22d3ee",
    "#34d399",
    "#a3e635",
    "#facc15",
    "#fb923c",
    "#f87171",
    "#fb7185",
    "#c084fc",
    "#818cf8",
    "#67e8f9",
  ];

  // Get current user to check role
  const { data: userData } = useQuery<{ user: User & { permissions?: Role["permissions"] } }>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  const canManageProducts =
    userData?.user?.role === "admin" || Boolean(userData?.user?.permissions?.manageProducts);
  const canManageCrossSellingGroups =
    userData?.user?.role === "admin" ||
    Boolean(userData?.user?.permissions?.manageCrossSellingGroups);
  const userAllowedChannelIds = userData?.user?.salesChannelIds ?? null;

  const { data: productCategoriesData } = useQuery<{
    categoryIds: string[];
    categoryNames: string[];
  }>({
    queryKey: ["/api/products", product?.id, "categories"],
    queryFn: async () => {
      if (!product) throw new Error("No product");
      const response = await fetch(`/api/products/${product.id}/categories`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch product categories");
      }
      return response.json();
    },
    enabled: !!product && open,
  });

  const { data: productSalesChannelsData } = useQuery<{
    salesChannelIds: string[];
  }>({
    queryKey: ["/api/products", product?.id, "sales-channels"],
    queryFn: async () => {
      if (!product) throw new Error("No product");
      const response = await fetch(`/api/products/${product.id}/sales-channels`, {
        credentials: "include",
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error("Failed to fetch product sales channels: " + errorText);
      }
      return response.json();
    },
    enabled: !!product && open,
  });

  const updateCategoriesMutation = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error("No product");
      const response = await apiRequest("PATCH", `/api/products/${product.id}/categories`, {
        categoryIds,
      });
      return response.json();
    },
    onSuccess: () => {
      if (!product) return;
      queryClient.invalidateQueries({ queryKey: ["/api/products", product.id, "categories"] });
      toast({ title: t("products.categoriesUpdated") });
      setPluginWarning(false);
    },
    onError: (error: Error) => {
      if (
        error.message.includes("MetaBundleVariants") ||
        error.message.includes("BundleCacheInvalidationSubscriber") ||
        error.message.includes("bin2hex()")
      ) {
        if (product) {
          queryClient.invalidateQueries({ queryKey: ["/api/products", product.id, "categories"] });
        }
        toast({
          title: t("products.categoriesUpdated"),
          description: t("products.pluginWarning"),
        });
        setPluginWarning(true);
        return;
      }
      toast({
        title: t("products.updateError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateSalesChannelsMutation = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error("No product");
      const response = await apiRequest("PATCH", `/api/products/${product.id}/sales-channels`, {
        salesChannelIds,
      });
      return response.json();
    },
    onSuccess: () => {
      if (!product) return;
      queryClient.invalidateQueries({ queryKey: ["/api/products", product.id, "sales-channels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products", product.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: t("products.salesChannelsUpdated") });
      setPluginWarning(false);
    },
    onError: (error: Error) => {
      if (
        error.message.includes("MetaBundleVariants") ||
        error.message.includes("BundleCacheInvalidationSubscriber") ||
        error.message.includes("bin2hex()")
      ) {
        if (product) {
          queryClient.invalidateQueries({ queryKey: ["/api/products", product.id, "sales-channels"] });
          queryClient.invalidateQueries({ queryKey: ["/api/products", product.id] });
          queryClient.invalidateQueries({ queryKey: ["/api/products"] });
        }
        toast({
          title: t("products.salesChannelsUpdated"),
          description: t("products.pluginWarning"),
        });
        setPluginWarning(true);
        return;
      }
      toast({
        title: t("products.salesChannelsUpdateError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: crossSellingData, refetch: refetchCrossSelling } = useQuery<{
    crossSellings: CrossSellingGroup[];
  }>({
    queryKey: ["/api/products", product?.id, "cross-selling"],
    queryFn: async () => {
      if (!product) throw new Error("No product");
      const response = await fetch(`/api/products/${product.id}/cross-selling`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch cross-selling");
      return response.json();
    },
    enabled: !!product && open,
    staleTime: 30_000,
  });

  const { data: productDataQuality } = useQuery<{
    score: number;
    criteriaCount: number;
    missingFields: string[];
    criteria?: Array<{ key: string; value: number }>;
  }>({
    queryKey: ["/api/products", product?.id, "data-quality"],
    queryFn: async () => {
      if (!product) throw new Error("No product");
      const response = await fetch(`/api/products/${product.id}/data-quality`, {
        credentials: "include",
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error("Failed to fetch product data quality: " + errorText);
      }
      return response.json();
    },
    enabled: !!product && open,
  });

  const crossSellings = crossSellingData?.crossSellings || [];
  const totalCrossSellingProducts = crossSellings.reduce(
    (sum, cs) => sum + (cs.products?.length || 0),
    0
  );
  
  const isAdmin = userData?.user?.role === "admin";

  useEffect(() => {
    if (productCategoriesData) {
      setCategoryIds(productCategoriesData.categoryIds || []);
    }
  }, [productCategoriesData]);

  useEffect(() => {
    if (productSalesChannelsData) {
      setSalesChannelIds(productSalesChannelsData.salesChannelIds || []);
    }
  }, [productSalesChannelsData]);

  useEffect(() => {
    if (product?.id) {
      setPluginWarning(false);
    }
  }, [product?.id]);

  const dataQualityCriteria = useMemo(() => {
    if (!productDataQuality?.criteria) return [];
    return productDataQuality.criteria.map((item, index) => {
      const num = Number(item.value);
      const value = Number.isFinite(num) ? Math.min(100, Math.max(0, num)) : 0;
      return {
        key: item.key,
        label: t(`products.dataQualityFields.${item.key}`, item.key),
        value,
        color: dataQualityColors[index % dataQualityColors.length],
      };
    });
  }, [productDataQuality?.criteria, t]);

  const renderDataQualityShape = (props: any): JSX.Element => {
    const { points, cx, cy } = props;
    if (!points || points.length === 0) return <g />;
    const centerX = Number(cx);
    const centerY = Number(cy);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return <g />;

    const safe = (p: any) => {
      const x = Number(p?.x);
      const y = Number(p?.y);
      return { x: Number.isFinite(x) ? x : centerX, y: Number.isFinite(y) ? y : centerY };
    };

    return (
      <g>
        {points.map((point: any, index: number) => {
          const nextPoint = points[(index + 1) % points.length];
          const a = safe(point);
          const b = safe(nextPoint);
          const color = point?.payload?.color || "#3b82f6";
          const path = `M ${centerX} ${centerY} L ${a.x} ${a.y} L ${b.x} ${b.y} Z`;
          return (
            <path
              key={`dq-segment-${index}`}
              d={path}
              fill={color}
              fillOpacity={0.7}
              stroke={color}
              strokeOpacity={0.9}
              filter="url(#dqGlow)"
            />
          );
        })}
        <polygon
          points={points.map((point: any) => {
            const { x, y } = safe(point);
            return `${x},${y}`;
          }).join(" ")}
          fill="none"
          stroke="#93c5fd"
          strokeOpacity={0.95}
          strokeWidth={1.5}
          filter="url(#dqGlow)"
        />
      </g>
    );
  };

  if (!product) return null;

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
            {/* Product Image und 3D-Vorschau */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {product.imageUrl && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">{t("products.image", "Produktbild")}</p>
                  <div className="aspect-video bg-muted rounded-md overflow-hidden">
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-full h-full object-cover"
                      data-testid={`img-product-detail-${product.id}`}
                    />
                  </div>
                </div>
              )}
              <div className={!product.imageUrl ? "md:col-span-2" : ""}>
                <p className="text-xs text-muted-foreground mb-1.5">3D-Vorschau (GLB)</p>
                <Product3DPreview
                  productNumber={product.productNumber}
                  manufacturerNumber={product.manufacturerNumber}
                  productId={product.id}
                  canManageProducts={canManageProducts}
                />
              </div>
            </div>

            {/* Product Info Grid */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-3">
                <p className="text-xs text-muted-foreground">
                  {t("products.productNumber")}
                </p>
                <p className="font-mono font-medium" data-testid="text-product-number">
                  {product.productNumber}
                </p>
                {product.name && <p className="text-xs text-muted-foreground mt-1">{product.name}</p>}
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

            {(product.variants && product.variants.length > 0) ||
            (product.childCount != null && product.childCount > 0) ? (
              <Card className="p-3">
                <p className="text-xs text-muted-foreground mb-2">{t("products.variants")}</p>
                {product.variants && product.variants.length > 0 ? (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("products.variantsTable.productNumber")}</TableHead>
                          <TableHead>{t("products.variantsTable.options")}</TableHead>
                          <TableHead className="text-right">{t("products.variantsTable.net")}</TableHead>
                          <TableHead className="text-right">{t("products.variantsTable.gross")}</TableHead>
                          <TableHead className="text-right">{t("products.variantsTable.stock")}</TableHead>
                          <TableHead>{t("products.variantsTable.available")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {product.variants.map((v) => (
                          <TableRow key={v.id}>
                            <TableCell className="font-mono text-xs">{v.productNumber ?? "—"}</TableCell>
                            <TableCell className="text-xs max-w-[220px]">
                              {v.options?.length
                                ? v.options.map((o) => `${o.group}: ${o.option}`).join("; ")
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right text-xs">€{v.netPrice.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-xs">€{v.price.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{v.stock}</TableCell>
                            <TableCell>
                              <Badge variant={v.available ? "default" : "secondary"}>
                                {v.available ? t("products.available") : t("products.notAvailable")}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("products.variantsNotLoaded")}</p>
                )}
              </Card>
            ) : null}

            {/* Description */}
            {product.description && (
              <Card className="p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  {t("products.description")}
                </p>
                <p className="text-sm">{product.description}</p>
              </Card>
            )}

            {pluginWarning && (
              <Card className="p-3 border-amber-200 bg-amber-50/60">
                <p className="text-sm font-medium">{t("products.pluginWarningTitle")}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("products.pluginWarningBody")}
                </p>
              </Card>
            )}

            {productDataQuality && (
              <Card className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {t("products.dataQualityTitle")}
                  </p>
                  <span className="text-sm font-medium" data-testid="text-product-data-quality-score">
                    {Number.isFinite(Number(productDataQuality.score)) ? productDataQuality.score : 0}%
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.min(100, Math.max(0, Number(productDataQuality.score) || 0))}%` }}
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("products.dataQualityMissing")}
                  </p>
                  {productDataQuality.missingFields.length === 0 ? (
                    <p className="text-sm">{t("products.dataQualityComplete")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {productDataQuality.missingFields.map((field) => (
                        <Badge key={field} variant="secondary">
                          {t(`products.dataQualityFields.${field}`)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                {dataQualityCriteria.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">
                      {t("products.dataQualityTitle")}
                    </div>
                    <div className="h-96 w-full" data-testid="chart-product-data-quality-radar">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={dataQualityCriteria} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                          <defs>
                            <filter id="dqGlow" x="-30%" y="-30%" width="160%" height="160%">
                              <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                              <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                              </feMerge>
                            </filter>
                            <radialGradient id="dqGradient" cx="50%" cy="50%" r="60%">
                              <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.45" />
                              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.15" />
                            </radialGradient>
                          </defs>
                          <PolarGrid stroke="#e5e7eb" radialLines={true} gridType="polygon" strokeOpacity={0.9} />
                          <PolarAngleAxis
                            dataKey="label"
                            tick={({ payload, x, y, textAnchor, ...props }) => (
                              <text
                                {...props}
                                x={x}
                                y={y}
                                textAnchor={textAnchor}
                                fontSize={12}
                                fontWeight={600}
                                fill={payload?.payload?.color || "#bfdbfe"}
                              >
                                {payload.value}
                              </text>
                            )}
                            tickLine={false}
                            axisLine={false}
                          />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                          <Radar
                            dataKey="value"
                            stroke="#93c5fd"
                            strokeOpacity={0.6}
                            fill="url(#dqGradient)"
                            fillOpacity={0.6}
                          />
                          <Radar
                            dataKey="value"
                            stroke="transparent"
                            fill="transparent"
                            shape={renderDataQualityShape}
                            dot={({ cx, cy, payload }) => {
                              const x = Number(cx);
                              const y = Number(cy);
                              if (!Number.isFinite(x) || !Number.isFinite(y)) {
                                return <g />;
                              }
                              return (
                                <circle
                                  cx={x}
                                  cy={y}
                                  r={6}
                                  fill={payload?.color}
                                  stroke="#e2e8f0"
                                  strokeWidth={1.5}
                                />
                              );
                            }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </Card>
            )}

            <Card className="p-3 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("products.categories")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(productCategoriesData?.categoryNames?.length
                    ? productCategoriesData.categoryNames
                    : product.categoryNames || []
                  ).map((name) => (
                    <Badge key={name} variant="secondary">
                      {name}
                    </Badge>
                  ))}
                  {(productCategoriesData?.categoryNames?.length ?? 0) === 0 && (
                    <span className="text-xs text-muted-foreground">{t("categories.noneSelected")}</span>
                  )}
                </div>
              </div>

              {canManageProducts && (
                <div className="space-y-2">
                  <CategoryMultiSelect value={categoryIds} onChange={setCategoryIds} />
                  <Button
                    size="sm"
                    onClick={() => updateCategoriesMutation.mutate()}
                    disabled={updateCategoriesMutation.isPending}
                  >
                    {updateCategoriesMutation.isPending
                      ? t("common.saving")
                      : t("products.assignCategories")}
                  </Button>
                </div>
              )}
            </Card>

            {canManageProducts && (
              <Card className="p-3 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("products.salesChannels")}
                  </p>
                  <SalesChannelSelector
                    selectedChannelIds={salesChannelIds}
                    onSelectionChange={setSalesChannelIds}
                    userAllowedChannelIds={userAllowedChannelIds}
                    isAdmin={Boolean(isAdmin)}
                    buttonLabelKey="salesChannel.assign"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => updateSalesChannelsMutation.mutate()}
                  disabled={updateSalesChannelsMutation.isPending}
                >
                  {updateSalesChannelsMutation.isPending
                    ? t("common.saving")
                    : t("common.save")}
                </Button>
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
                {canManageCrossSellingGroups && (
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
                              className="text-xs max-w-[220px] whitespace-normal text-left font-normal"
                              title={`${p.productNumber}${p.name ? ` — ${p.name}` : ""}`}
                            >
                              <span className="block font-medium line-clamp-2">{p.name || p.productNumber}</span>
                              {p.name && (
                                <span className="block font-mono text-[10px] text-muted-foreground">{p.productNumber}</span>
                              )}
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
