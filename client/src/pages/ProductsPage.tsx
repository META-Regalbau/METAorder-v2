import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Package, Search, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import type { Product } from "@shared/schema";
import ProductDetailModal from "@/components/ProductDetailModal";

export default function ProductsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const limit = 50;

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

  const { data, isLoading, error } = useQuery<{ products: Product[], total: number }>({
    queryKey: ['/api/products', page, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        page: page.toString(),
      });
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
      }
      const response = await fetch(`/api/products?${params.toString()}`);
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

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('products.searchPlaceholder')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-10"
          data-testid="input-search-products"
        />
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
                      <p className="text-lg font-bold" data-testid={`text-price-${product.id}`}>
                        €{product.price.toFixed(2)}
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
