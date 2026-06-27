import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Package, Search, ChevronLeft, ChevronRight, Info, Filter, Ruler } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import type { Product, User, Role } from "@shared/schema";
import ProductDetailModal from "@/components/ProductDetailModal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SalesChannelSelector } from "@/components/SalesChannelSelector";
import { useLocation } from "wouter";

interface Category {
  id: string;
  name: string;
  parentId: string | null;
}

export default function ProductsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [location] = useLocation();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [widthInput, setWidthInput] = useState("");
  const [heightInput, setHeightInput] = useState("");
  const [depthInput, setDepthInput] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [showWithGlb, setShowWithGlb] = useState(false);
  const [showWithVariantsOnly, setShowWithVariantsOnly] = useState(false);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [limit, setLimit] = useState(50);
  
  // Fetch current user to check if admin
  const { data: userData } = useQuery<{ user: User & { permissions?: Role["permissions"] } }>({
    queryKey: ["/api/auth/me"],
  });
  
  const user = userData?.user;
  const isAdmin = user?.role === 'admin';
  const canManageProducts = Boolean(user?.permissions?.manageProducts || isAdmin);
  const userAllowedChannelIds = user?.salesChannelIds ?? null;

  useEffect(() => {
    if (isAdmin) return;
    if (Array.isArray(userAllowedChannelIds)) {
      setSelectedChannelIds(userAllowedChannelIds);
    }
  }, [isAdmin, userAllowedChannelIds]);

  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const searchParam = params.get("search");
    if (searchParam !== null) {
      setSearchInput(searchParam);
      setPage(1);
    }
  }, [location]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      // Reset to page 1 when search changes
      if (searchInput !== debouncedSearch) {
        setPage(1);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch categories (only when user is loaded to avoid auth race)
  const { data: categoriesData } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
    queryFn: async () => {
      const response = await fetch('/api/categories', { credentials: 'include' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const msg = (body as { error?: string })?.error || response.statusText;
        throw new Error(msg || 'Failed to fetch categories');
      }
      return response.json();
    },
    enabled: !!userData?.user,
  });

  const categories = categoriesData || [];

  // Parse dimension inputs
  const width = widthInput ? parseFloat(widthInput) : undefined;
  const height = heightInput ? parseFloat(heightInput) : undefined;
  const depth = depthInput ? parseFloat(depthInput) : undefined;

  // Limit-Änderung → Seite 1
  useEffect(() => {
    setPage(1);
  }, [limit]);

  // Fetch products with all filters (only when user is loaded to avoid auth race)
  const { data, isLoading, error } = useQuery<{ products: Product[], total: number }>({
    queryKey: [
      '/api/products',
      page,
      limit,
      debouncedSearch,
      selectedCategoryId,
      width,
      height,
      depth,
      showInactive,
      showWithGlb,
      showWithVariantsOnly,
      selectedChannelIds,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        page: page.toString(),
      });
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
      }
      // Only add categoryId if it's not "all" (which means show all categories)
      if (selectedCategoryId && selectedCategoryId !== 'all') {
        params.set('categoryId', selectedCategoryId);
      }
      // Add dimension filters
      if (width && !isNaN(width)) {
        params.set('width', width.toString());
      }
      if (height && !isNaN(height)) {
        params.set('height', height.toString());
      }
      if (depth && !isNaN(depth)) {
        params.set('depth', depth.toString());
      }
      // Add showInactive filter (admin only)
      if (canManageProducts && showInactive) {
        params.set('showInactive', 'true');
      }
      if (selectedChannelIds.length > 0) {
        params.set("salesChannelIds", selectedChannelIds.join(","));
      }
      if (showWithGlb) {
        params.set("withGlb", "true");
      }
      params.set("includeVariants", "true");
      if (showWithVariantsOnly) {
        params.set("withVariantsOnly", "true");
      }
      const response = await fetch(`/api/products?${params.toString()}`, { credentials: 'include' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const msg = (body as { error?: string })?.error || response.statusText;
        throw new Error(msg || 'Failed to fetch products');
      }
      return response.json();
    },
    enabled: !!userData?.user,
  });

  const products = data?.products || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);
  const isShopwarePluginError = (message?: string) =>
    Boolean(
      message &&
        (message.includes("MetaBundleVariants") ||
          message.includes("BundleCacheInvalidationSubscriber") ||
          message.includes("bin2hex()"))
    );

  const getDataQualityBadgeClass = (score?: number) => {
    if (typeof score !== "number") return "bg-muted text-muted-foreground";
    if (score >= 100) return "bg-green-600 text-white";
    if (score > 50) return "bg-yellow-500 text-black";
    return "bg-red-600 text-white";
  };

  const toggleProductMutation = useMutation({
    mutationFn: async (payload: { productId: string; active: boolean }) => {
      const response = await apiRequest("PATCH", `/api/products/${payload.productId}/active`, {
        active: payload.active,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: t("products.updateSuccess"),
      });
    },
    onError: (error: Error) => {
      if (isShopwarePluginError(error.message)) {
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
        toast({
          title: t("products.updateSuccess"),
          description: t("products.pluginWarning"),
        });
        return;
      }
      toast({
        title: t("products.updateError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="heading-products">
              {t('products.title')}
            </h1>
            <p className="text-muted-foreground">{t('products.subtitle')}</p>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          {total} {t('products.totalProducts')}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[300px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('products.searchPlaceholder')}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-10"
              data-testid="input-search-products"
            />
          </div>
          <div className="w-full sm:w-auto sm:min-w-[250px]">
            <Select 
              value={selectedCategoryId} 
              onValueChange={(value) => {
                setSelectedCategoryId(value);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="select-category-filter">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder={t('products.allCategories')} />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-all-categories">
                  {t('products.allCategories')}
                </SelectItem>
                {categories.map((category) => (
                  <SelectItem 
                    key={category.id} 
                    value={category.id}
                    data-testid={`option-category-${category.id}`}
                  >
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SalesChannelSelector
            selectedChannelIds={selectedChannelIds}
            onSelectionChange={setSelectedChannelIds}
            userAllowedChannelIds={userAllowedChannelIds}
            isAdmin={isAdmin}
            enabled={!!userData?.user}
          />
        </div>

        {/* Dimensions Filters */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Ruler className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">{t('products.dimensionsFilter')}</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="width-filter" className="text-xs text-muted-foreground">
                {t('products.width')} (mm)
              </Label>
              <Input
                id="width-filter"
                type="number"
                placeholder={t('products.anyWidth')}
                value={widthInput}
                onChange={(e) => {
                  setWidthInput(e.target.value);
                  setPage(1);
                }}
                data-testid="input-width-filter"
              />
            </div>
            <div>
              <Label htmlFor="height-filter" className="text-xs text-muted-foreground">
                {t('products.height')} (mm)
              </Label>
              <Input
                id="height-filter"
                type="number"
                placeholder={t('products.anyHeight')}
                value={heightInput}
                onChange={(e) => {
                  setHeightInput(e.target.value);
                  setPage(1);
                }}
                data-testid="input-height-filter"
              />
            </div>
            <div>
              <Label htmlFor="depth-filter" className="text-xs text-muted-foreground">
                {t('products.depth')} (mm)
              </Label>
              <Input
                id="depth-filter"
                type="number"
                placeholder={t('products.anyDepth')}
                value={depthInput}
                onChange={(e) => {
                  setDepthInput(e.target.value);
                  setPage(1);
                }}
                data-testid="input-depth-filter"
              />
            </div>
          </div>
          
          {/* Admin-only: Show Inactive | Alle: Show with GLB */}
          <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t">
            {canManageProducts && (
              <div className="flex items-center gap-2">
                <Switch
                  id="show-inactive"
                  checked={showInactive}
                  onCheckedChange={(checked) => {
                    setShowInactive(checked);
                    setPage(1);
                  }}
                  data-testid="switch-show-inactive"
                />
                <Label htmlFor="show-inactive" className="text-sm cursor-pointer">
                  {t('products.showInactiveOnly')}
                </Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id="show-with-glb"
                checked={showWithGlb}
                onCheckedChange={(checked) => {
                  setShowWithGlb(checked);
                  setPage(1);
                }}
                data-testid="switch-show-with-glb"
              />
              <Label htmlFor="show-with-glb" className="text-sm cursor-pointer">
                {t('products.showWithGlb')}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="show-with-variants-only"
                checked={showWithVariantsOnly}
                onCheckedChange={(checked) => {
                  setShowWithVariantsOnly(checked);
                  setPage(1);
                }}
                data-testid="switch-show-with-variants-only"
              />
              <Label htmlFor="show-with-variants-only" className="text-sm cursor-pointer">
                {t("products.showWithVariantsOnly")}
              </Label>
            </div>
            {/* Anzahl bei gesetzten Filtern */}
            {!isLoading && !error && (
              <div className="ml-auto font-semibold text-sm">
                {total === 0
                  ? t('products.noProductsCount', '0 Produkte')
                  : t('products.filteredCount', '{{count}} Produkte gefunden', { count: total })}
              </div>
            )}
          </div>
        </Card>
      </div>

      {error ? (
        <Card className="p-12 text-center">
          <p className="text-destructive font-medium">{t('errors.loadFailed')}</p>
          <p className="text-muted-foreground text-sm mt-2">
            {error instanceof Error ? error.message : String(error)}
          </p>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4 animate-pulse">
              <div className="aspect-square bg-muted rounded-md mb-3"></div>
              <div className="h-4 bg-muted rounded mb-2"></div>
              <div className="h-3 bg-muted rounded w-2/3"></div>
            </Card>
          ))}
        </div>
      ) : products.length === 0 ? (
        <Card className="p-12 text-center">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-lg font-medium">{t('products.noProducts')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('products.noProductsDescription')}</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {products.map((product) => (
              <Card 
                key={product.id} 
                className="p-4 hover-elevate transition-all"
                data-testid={`card-product-${product.id}`}
              >
                {/* Product Image */}
                <div className="h-28 w-28 bg-muted rounded-md mb-3 overflow-hidden mx-auto">
                  {product.imageUrl ? (
                    <img 
                      src={product.imageUrl} 
                      alt={product.name}
                      className="w-full h-full object-cover"
                      data-testid={`img-product-${product.id}`}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="h-16 w-16 text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Product Info */}
                <div className="space-y-2">
                  <div>
                    <h3 className="font-semibold text-sm line-clamp-2" data-testid={`text-name-${product.id}`}>
                      {product.name}
                    </h3>
                    <p className="text-xs text-muted-foreground font-mono" data-testid={`text-number-${product.id}`}>
                      {product.productNumber}
                    </p>
                  </div>

                  {/* Manufacturer */}
                  {product.manufacturerName && (
                    <p className="text-xs text-muted-foreground" data-testid={`text-manufacturer-${product.id}`}>
                      {product.manufacturerName}
                    </p>
                  )}

                  {/* Price */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-bold" data-testid={`text-price-net-${product.id}`}>
                        €{product.netPrice.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">{t('orderDetail.net')}</span>
                      </p>
                      <p className="text-sm text-muted-foreground" data-testid={`text-price-gross-${product.id}`}>
                        €{product.price.toFixed(2)} <span className="text-xs text-muted-foreground">{t('orderDetail.gross')}</span>
                      </p>
                      {product.priceRules && product.priceRules.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {t('products.graduatedPricing')}
                        </p>
                      )}
                    </div>
                    <Badge 
                      variant={product.available ? "default" : "secondary"}
                      data-testid={`badge-availability-${product.id}`}
                    >
                      {product.available ? t('products.available') : t('products.notAvailable')}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={product.active === false ? "secondary" : "default"}>
                        {product.active === false ? t("products.statusInactive") : t("products.statusActive")}
                      </Badge>
                      <Badge
                        className={getDataQualityBadgeClass(product.dataQualityScore)}
                        data-testid={`badge-data-quality-${product.id}`}
                      >
                        {t("products.dataQualityBadge")} {product.dataQualityScore ?? 0}%
                      </Badge>
                    </div>
                    {canManageProducts && (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={product.active !== false}
                          onCheckedChange={(checked) => {
                            toggleProductMutation.mutate({ productId: product.id, active: checked });
                          }}
                          data-testid={`switch-toggle-active-${product.id}`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {product.active === false ? t("products.activate") : t("products.deactivate")}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Stock */}
                  <div className="text-xs text-muted-foreground">
                    {t('products.stock')}: <span className="font-medium" data-testid={`text-stock-${product.id}`}>{product.stock}</span>
                  </div>

                  {/* Packaging Unit */}
                  {product.packagingUnit && (
                    <div className="text-xs text-muted-foreground">
                      {t('products.unit')}: {product.packagingUnit}
                    </div>
                  )}

                  {((product.variants?.length ?? 0) > 0 ||
                    (product.childCount != null && product.childCount > 0)) && (
                    <div className="text-xs space-y-1 pt-1 border-t border-border/60">
                      <Badge variant="outline" className="text-xs" data-testid={`badge-variants-${product.id}`}>
                        {t("products.variantCount", {
                          count: product.variants?.length ?? product.childCount ?? 0,
                          defaultValue: "{{count}} Varianten",
                        })}
                      </Badge>
                      {product.variants && product.variants.length > 0 && (
                        <ul className="text-muted-foreground space-y-0.5 list-none">
                          {product.variants.slice(0, 3).map((v) => (
                            <li key={v.id} className="truncate font-mono" data-testid={`text-variant-${v.id}`}>
                              {v.productNumber || v.name}
                              {v.options?.length
                                ? ` · ${v.options.map((o) => o.option).join(", ")}`
                                : null}
                            </li>
                          ))}
                          {product.variants.length > 3 && (
                            <li className="text-muted-foreground">
                              +{product.variants.length - 3}
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* View Details Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => setSelectedProduct(product)}
                    data-testid={`button-view-details-${product.id}`}
                  >
                    <Info className="h-4 w-4 mr-2" />
                    {t('products.viewDetails')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {/* Pagination – immer sichtbar, wenn Produkte geladen */}
          {total > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 p-4 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3 order-2 sm:order-1">
                <span className="text-sm text-muted-foreground">
                  {t('products.showingRange', {
                    from: (page - 1) * limit + 1,
                    to: Math.min(page * limit, total),
                    total,
                    defaultValue: '{{from}}–{{to}} von {{total}} Produkte',
                  })}
                </span>
                <Select value={limit.toString()} onValueChange={(v) => setLimit(Number(v))}>
                  <SelectTrigger className="w-24 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">{t('common.rowsPerPage', 'pro Seite')}</span>
              </div>
              <div className="flex items-center gap-1 order-1 sm:order-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  data-testid="button-first-page"
                  title={t('common.first')}
                >
                  «
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  data-testid="button-previous-page"
                >
                  <ChevronLeft className="h-4 w-4 mr-0.5" />
                  {t('common.previous')}
                </Button>
                <span className="text-sm px-3 py-1.5 min-w-[7rem] text-center">
                  {t('common.pageInfo', { current: page, total: totalPages, defaultValue: `Seite ${page} von ${totalPages}` })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  data-testid="button-next-page"
                >
                  {t('common.next')}
                  <ChevronRight className="h-4 w-4 ml-0.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                  data-testid="button-last-page"
                  title={t('common.last')}
                >
                  »
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Product Detail Modal – key erzwingt Neuaufbau bei Produktwechsel, damit immer das gewählte Produkt angezeigt wird */}
      <ProductDetailModal
        key={selectedProduct?.id ?? "closed"}
        product={selectedProduct}
        open={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
      />
    </div>
  );
}
