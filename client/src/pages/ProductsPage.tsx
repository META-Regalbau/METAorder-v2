import { useQuery } from "@tanstack/react-query";
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
import type { Product, User } from "@shared/schema";
import ProductDetailModal from "@/components/ProductDetailModal";
import { getAuthHeaders } from "@/lib/queryClient";

interface Category {
  id: string;
  name: string;
  parentId: string | null;
}

export default function ProductsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [widthInput, setWidthInput] = useState("");
  const [heightInput, setHeightInput] = useState("");
  const [depthInput, setDepthInput] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const limit = 50;
  
  // Fetch current user to check if admin
  const { data: userData } = useQuery<{ user: User }>({
    queryKey: ["/api/auth/me"],
  });
  
  const user = userData?.user;
  const isAdmin = user?.role === 'admin';

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

  // Fetch categories
  const { data: categoriesData } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
    queryFn: async () => {
      const response = await fetch('/api/categories', {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('Failed to fetch categories');
      }
      return response.json();
    },
  });

  const categories = categoriesData || [];

  // Parse dimension inputs
  const width = widthInput ? parseFloat(widthInput) : undefined;
  const height = heightInput ? parseFloat(heightInput) : undefined;
  const depth = depthInput ? parseFloat(depthInput) : undefined;

  // Fetch products with all filters
  const { data, isLoading, error } = useQuery<{ products: Product[], total: number }>({
    queryKey: ['/api/products', page, debouncedSearch, selectedCategoryId, width, height, depth, showInactive],
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
      if (isAdmin && showInactive) {
        params.set('showInactive', 'true');
      }
      const response = await fetch(`/api/products?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('Failed to fetch products');
      }
      return response.json();
    },
  });

  const products = data?.products || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

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
          
          {/* Admin-only: Show Inactive Toggle */}
          {isAdmin && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t">
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
                <div className="aspect-square bg-muted rounded-md mb-3 overflow-hidden">
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                data-testid="button-previous-page"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                {t('common.previous')}
              </Button>
              <span className="text-sm text-muted-foreground px-4">
                {t('common.pageInfo', { current: page, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                data-testid="button-next-page"
              >
                {t('common.next')}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* Product Detail Modal */}
      <ProductDetailModal
        product={selectedProduct}
        open={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
      />
    </div>
  );
}
