import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  X,
  Plus,
  Trash2,
  Search,
  Package,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Product, CrossSellingGroup, CrossSellingProduct } from "@shared/schema";

interface CrossSellingManagerProps {
  product: Product;
  open: boolean;
  onClose: () => void;
}

export default function CrossSellingManager({
  product,
  open,
  onClose,
}: CrossSellingManagerProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [newGroupName, setNewGroupName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  // Fetch cross-selling data
  const { data: crossSellingData, refetch: refetchCrossSelling } = useQuery<{
    crossSellings: CrossSellingGroup[];
  }>({
    queryKey: ["/api/products", product.id, "cross-selling"],
    queryFn: async () => {
      const response = await fetch(`/api/products/${product.id}/cross-selling`);
      if (!response.ok) throw new Error("Failed to fetch cross-selling");
      return response.json();
    },
    enabled: open,
  });

  // Fetch rule-based suggestions
  const { data: suggestionsData, isLoading: loadingSuggestions } = useQuery<{
    suggestions: Product[];
  }>({
    queryKey: ["/api/products", product.id, "cross-selling-suggestions"],
    queryFn: async () => {
      const response = await fetch(`/api/products/${product.id}/cross-selling-suggestions`);
      if (!response.ok) throw new Error("Failed to fetch suggestions");
      return response.json();
    },
    enabled: open,
  });

  // Search products
  const { data: searchResults } = useQuery<{ products: Product[]; total: number }>({
    queryKey: ["/api/products", "search", searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: "20",
        page: "1",
      });
      if (searchTerm) {
        params.set("search", searchTerm);
      }
      const response = await fetch(`/api/products?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to search products");
      return response.json();
    },
    enabled: searchTerm.length > 2,
  });

  // Create cross-selling group mutation
  const createGroupMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiRequest("POST", `/api/products/${product.id}/cross-selling`, {
        name,
        productIds: [],
      });
    },
    onSuccess: () => {
      toast({
        title: t("crossSelling.groupCreated"),
        description: t("crossSelling.groupCreatedDescription"),
      });
      setNewGroupName("");
      refetchCrossSelling();
    },
    onError: () => {
      toast({
        title: t("errors.createFailed"),
        description: t("crossSelling.groupCreateError"),
        variant: "destructive",
      });
    },
  });

  // Update cross-selling mutation
  const updateCrossSellingMutation = useMutation({
    mutationFn: async ({
      crossSellingId,
      productIds,
    }: {
      crossSellingId: string;
      productIds: string[];
    }) => {
      await apiRequest(
        "PUT",
        `/api/products/${product.id}/cross-selling/${crossSellingId}`,
        { productIds }
      );
    },
    onSuccess: () => {
      toast({
        title: t("crossSelling.updated"),
        description: t("crossSelling.updatedDescription"),
      });
      setSelectedGroupId(null);
      setSelectedProductIds([]);
      refetchCrossSelling();
    },
    onError: () => {
      toast({
        title: t("errors.updateFailed"),
        description: t("crossSelling.updateError"),
        variant: "destructive",
      });
    },
  });

  // Delete cross-selling group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async (crossSellingId: string) => {
      await apiRequest(
        "DELETE",
        `/api/products/${product.id}/cross-selling/${crossSellingId}`,
        undefined
      );
    },
    onSuccess: () => {
      toast({
        title: t("crossSelling.deleted"),
        description: t("crossSelling.deletedDescription"),
      });
      refetchCrossSelling();
    },
    onError: () => {
      toast({
        title: t("errors.deleteFailed"),
        description: t("crossSelling.deleteError"),
        variant: "destructive",
      });
    },
  });

  const crossSellings = crossSellingData?.crossSellings || [];
  const suggestions = suggestionsData?.suggestions || [];
  const selectedGroup = crossSellings.find((cs) => cs.id === selectedGroupId);
  const currentProductIds = selectedGroup?.products?.map((p) => p.id) || [];

  const handleToggleProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  const handleSaveSelection = () => {
    if (selectedGroupId) {
      updateCrossSellingMutation.mutate({
        crossSellingId: selectedGroupId,
        productIds: selectedProductIds,
      });
    }
  };

  const handleSelectGroup = (groupId: string) => {
    const group = crossSellings.find((cs) => cs.id === groupId);
    setSelectedGroupId(groupId);
    setSelectedProductIds(group?.products?.map((p) => p.id) || []);
    setSearchTerm("");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("crossSelling.manageTitle")}</DialogTitle>
          <DialogDescription>
            {t("crossSelling.manageDescription", { product: product.name })}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="manual" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="manual" data-testid="tab-manual">
              {t("crossSelling.manualTab")}
            </TabsTrigger>
            <TabsTrigger value="suggestions" data-testid="tab-suggestions">
              <Sparkles className="h-4 w-4 mr-2" />
              {t("crossSelling.suggestionsTab")}
            </TabsTrigger>
          </TabsList>

          {/* Manual Tab */}
          <TabsContent value="manual" className="flex-1 overflow-y-auto space-y-4 mt-0">
            {/* Create New Group */}
            <Card className="p-4">
              <h3 className="font-semibold mb-3">{t("crossSelling.createGroup")}</h3>
              <div className="flex gap-2">
                <Input
                  placeholder={t("crossSelling.groupNamePlaceholder")}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  data-testid="input-group-name"
                />
                <Button
                  onClick={() => createGroupMutation.mutate(newGroupName)}
                  disabled={!newGroupName.trim() || createGroupMutation.isPending}
                  data-testid="button-create-group"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t("common.create")}
                </Button>
              </div>
            </Card>

            <Separator />

            {/* Existing Groups */}
            <div>
              <h3 className="font-semibold mb-3">
                {t("crossSelling.existingGroups")}
              </h3>

              {crossSellings.length === 0 ? (
                <Card className="p-6 text-center">
                  <Package className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {t("crossSelling.noGroups")}
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {crossSellings.map((cs) => (
                    <Card
                      key={cs.id}
                      className={`p-3 cursor-pointer hover-elevate transition-all ${
                        selectedGroupId === cs.id ? "ring-2 ring-primary" : ""
                      }`}
                      onClick={() => handleSelectGroup(cs.id)}
                      data-testid={`card-group-${cs.id}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">{cs.name}</h4>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {cs.products?.length || 0} {t("crossSelling.products")}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteGroupMutation.mutate(cs.id);
                            }}
                            data-testid={`button-delete-${cs.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      {cs.products && cs.products.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {cs.products.slice(0, 3).map((p) => (
                            <Badge
                              key={p.id}
                              variant="outline"
                              className="text-xs"
                            >
                              {p.productNumber}
                            </Badge>
                          ))}
                          {cs.products.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{cs.products.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Product Selection */}
            {selectedGroupId && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">
                      {t("crossSelling.selectProducts")}
                    </h3>
                    <Button
                      onClick={handleSaveSelection}
                      disabled={updateCrossSellingMutation.isPending}
                      data-testid="button-save-selection"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      {t("common.save")}
                    </Button>
                  </div>

                  {/* Search */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t("products.searchPlaceholder")}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                      data-testid="input-search-products"
                    />
                  </div>

                  {/* Selected Products Summary */}
                  <div className="mb-3 p-3 bg-muted rounded-md">
                    <p className="text-sm">
                      {selectedProductIds.length}{" "}
                      {t("crossSelling.productsSelected")}
                    </p>
                  </div>

                  {/* Product List */}
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {searchResults?.products
                      .filter((p) => p.id !== product.id)
                      .map((p) => {
                        const isSelected = selectedProductIds.includes(p.id);
                        return (
                          <Card
                            key={p.id}
                            className={`p-3 cursor-pointer hover-elevate ${
                              isSelected ? "ring-2 ring-primary" : ""
                            }`}
                            onClick={() => handleToggleProduct(p.id)}
                            data-testid={`card-select-product-${p.id}`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                                  isSelected
                                    ? "bg-primary border-primary"
                                    : "border-muted-foreground"
                                }`}
                              >
                                {isSelected && (
                                  <CheckCircle2 className="h-4 w-4 text-primary-foreground" />
                                )}
                              </div>
                              {p.imageUrl && (
                                <img
                                  src={p.imageUrl}
                                  alt={p.name}
                                  className="h-12 w-12 object-cover rounded"
                                />
                              )}
                              <div className="flex-1">
                                <p className="font-medium text-sm">{p.name}</p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {p.productNumber}
                                </p>
                              </div>
                              <p className="font-semibold">€{p.price.toFixed(2)}</p>
                            </div>
                          </Card>
                        );
                      })}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* Suggestions Tab */}
          <TabsContent value="suggestions" className="flex-1 overflow-y-auto space-y-4 mt-0">
            <div className="bg-primary/10 border border-primary/20 rounded-md p-4 mb-4">
              <div className="flex gap-2">
                <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm mb-1">
                    {t("crossSelling.suggestionsInfo")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("crossSelling.suggestionsDesc")}
                  </p>
                </div>
              </div>
            </div>

            {loadingSuggestions ? (
              <Card className="p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {t("common.loading")}
                </p>
              </Card>
            ) : suggestions.length === 0 ? (
              <Card className="p-6 text-center">
                <Sparkles className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium mb-1">
                  {t("crossSelling.noSuggestions")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("crossSelling.noSuggestionsDesc")}
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {suggestions.map((p) => (
                  <Card key={p.id} className="p-4" data-testid={`card-suggestion-${p.id}`}>
                    <div className="flex gap-3">
                      {p.imageUrl && (
                        <img
                          src={p.imageUrl}
                          alt={p.name}
                          className="h-16 w-16 object-cover rounded"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm mb-1 truncate">
                          {p.name}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono mb-2">
                          {p.productNumber}
                        </p>
                        <div className="flex items-center justify-between">
                          <p className="font-semibold">€{p.price.toFixed(2)}</p>
                          {p.available && (
                            <Badge variant="secondary" className="text-xs">
                              {t("products.available")}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
