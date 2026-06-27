import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Package, Plus, Trash2, Edit } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Bundle, BundleItem, Product, User, Role } from "@shared/schema";

type BundleItemWithDetails = BundleItem & { productName?: string | null };
type BundleWithDetails = Bundle & { items: BundleItemWithDetails[] };

type BundleFormItem = {
  productNumber: string;
  quantity: number;
};

type BundleFormState = {
  name: string;
  mockProductNumber: string;
  description: string;
  active: boolean;
  items: BundleFormItem[];
};

const emptyForm: BundleFormState = {
  name: "",
  mockProductNumber: "",
  description: "",
  active: true,
  items: [{ productNumber: "", quantity: 1 }],
};

export default function BundlesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBundle, setEditingBundle] = useState<BundleWithDetails | null>(null);
  const [formState, setFormState] = useState<BundleFormState>(emptyForm);
  const [productSearchTerm, setProductSearchTerm] = useState("");
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);

  const { data: userData } = useQuery<{ user: User & { permissions?: Role["permissions"] } }>({
    queryKey: ["/api/auth/me"],
  });
  const user = userData?.user;
  const isAdmin = user?.role === "admin";
  const canManageProducts = Boolean(user?.permissions?.manageProducts || isAdmin);

  const { data, isLoading, error } = useQuery<{ bundles: BundleWithDetails[] }>({
    queryKey: ["/api/bundles", includeInactive],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeInactive) {
        params.set("includeInactive", "true");
      }
      const response = await fetch(`/api/bundles?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch bundles");
      }
      return response.json();
    },
  });

  const bundles = data?.bundles ?? [];

  const { data: productSearchData, isLoading: productSearchLoading } = useQuery<{ products: Product[] }>({
    queryKey: ["/api/products", "bundle-search", productSearchTerm],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "20", page: "1", search: productSearchTerm });
      const response = await fetch(`/api/products?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to search products");
      }
      return response.json();
    },
    enabled: productSearchTerm.trim().length > 2,
  });

  const productSearchResults = productSearchData?.products ?? [];

  const resetForm = () => {
    setFormState(emptyForm);
    setEditingBundle(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (bundle: BundleWithDetails) => {
    setEditingBundle(bundle);
    setFormState({
      name: bundle.name,
      mockProductNumber: bundle.mockProductNumber,
      description: bundle.description || "",
      active: bundle.active === 1,
      items: bundle.items.map((item) => ({
        productNumber: item.productNumber,
        quantity: item.quantity,
      })),
    });
    setIsDialogOpen(true);
  };

  const updateItem = (index: number, updates: Partial<BundleFormItem>) => {
    setFormState((prev) => ({
      ...prev,
      items: prev.items.map((item, idx) => (idx === index ? { ...item, ...updates } : item)),
    }));
  };

  const addItemRow = () => {
    setFormState((prev) => ({
      ...prev,
      items: [...prev.items, { productNumber: "", quantity: 1 }],
    }));
  };

  const removeItemRow = (index: number) => {
    setFormState((prev) => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index),
    }));
  };

  const saveBundleMutation = useMutation({
    mutationFn: async () => {
      const items = formState.items
        .map((item) => ({
          productNumber: item.productNumber.trim(),
          quantity: item.quantity,
        }))
        .filter((item) => item.productNumber.length > 0);
      
      if (!formState.name.trim() || !formState.mockProductNumber.trim() || items.length === 0) {
        throw new Error(t("bundles.errors.invalidForm"));
      }
      
      if (items.some((item) => item.quantity < 1)) {
        throw new Error(t("bundles.errors.invalidQuantity"));
      }
      
      const payload = {
        name: formState.name.trim(),
        mockProductNumber: formState.mockProductNumber.trim(),
        description: formState.description.trim() || undefined,
        active: formState.active,
        items,
      };
      
      if (editingBundle) {
        const response = await apiRequest("PATCH", `/api/bundles/${editingBundle.id}`, payload);
        if (!response.ok) {
          const error = await response.json();
          const invalidProducts = Array.isArray(error.invalidProducts) ? error.invalidProducts.join(", ") : null;
          throw new Error(invalidProducts ? `${error.error} (${invalidProducts})` : error.error || "Failed to update bundle");
        }
        return response.json();
      }
      
      const response = await apiRequest("POST", "/api/bundles", payload);
      if (!response.ok) {
        const error = await response.json();
        const invalidProducts = Array.isArray(error.invalidProducts) ? error.invalidProducts.join(", ") : null;
        throw new Error(invalidProducts ? `${error.error} (${invalidProducts})` : error.error || "Failed to create bundle");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bundles"] });
      setIsDialogOpen(false);
      resetForm();
      toast({
        title: editingBundle ? t("bundles.updateSuccess") : t("bundles.createSuccess"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("bundles.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteBundleMutation = useMutation({
    mutationFn: async (bundleId: string) => {
      const response = await apiRequest("DELETE", `/api/bundles/${bundleId}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete bundle");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bundles"] });
      toast({
        title: t("bundles.deleteSuccess"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("bundles.deleteError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5" />
          <div>
            <h1 className="text-xl font-semibold">{t("bundles.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("bundles.description")}</p>
          </div>
        </div>
        {canManageProducts && (
          <Button onClick={openCreateDialog} data-testid="button-create-bundle">
            <Plus className="w-4 h-4 mr-2" />
            {t("bundles.create")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("bundles.listTitle")}</CardTitle>
          <div className="flex items-center gap-2">
            <Switch
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
              disabled={!canManageProducts}
            />
            <Label>{t("bundles.showInactive")}</Label>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
          ) : error ? (
            <div className="text-sm text-destructive">{t("bundles.loadError")}</div>
          ) : bundles.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t("bundles.empty")}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("bundles.table.name")}</TableHead>
                  <TableHead>{t("bundles.table.mockNumber")}</TableHead>
                  <TableHead>{t("bundles.table.items")}</TableHead>
                  <TableHead>{t("bundles.table.status")}</TableHead>
                  {canManageProducts && <TableHead>{t("bundles.table.actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bundles.map((bundle) => (
                  <TableRow key={bundle.id}>
                    <TableCell className="font-medium">{bundle.name}</TableCell>
                    <TableCell>{bundle.mockProductNumber}</TableCell>
                    <TableCell>
                      <div className="space-y-1 text-sm">
                        {bundle.items.map((item) => (
                          <div key={item.id} className="text-muted-foreground">
                            {(item.productName || item.productNumber) + ` x${item.quantity}`}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {bundle.active === 1 ? (
                        <Badge variant="default" className="bg-green-600">
                          {t("bundles.status.active")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{t("bundles.status.inactive")}</Badge>
                      )}
                    </TableCell>
                    {canManageProducts && (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDialog(bundle)}
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            {t("common.edit")}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteBundleMutation.mutate(bundle.id)}
                            disabled={deleteBundleMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            {t("common.delete")}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingBundle ? t("bundles.editTitle") : t("bundles.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editingBundle ? t("bundles.editDescription") : t("bundles.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("bundles.fields.name")}</Label>
                <Input
                  value={formState.name}
                  onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("bundles.fields.mockNumber")}</Label>
                <Input
                  value={formState.mockProductNumber}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, mockProductNumber: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("bundles.fields.description")}</Label>
              <Textarea
                value={formState.description}
                onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={formState.active}
                onCheckedChange={(active) => setFormState((prev) => ({ ...prev, active }))}
              />
              <Label>{t("bundles.fields.active")}</Label>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t("bundles.fields.items")}</Label>
                <Button variant="outline" size="sm" onClick={addItemRow}>
                  <Plus className="w-4 h-4 mr-1" />
                  {t("bundles.addItem")}
                </Button>
              </div>
                <div className="space-y-2">
                  <Label>{t("common.search")}</Label>
                  <Input
                    placeholder={t("common.search")}
                    value={productSearchTerm}
                    onChange={(event) => setProductSearchTerm(event.target.value)}
                  />
                  {productSearchTerm.trim().length > 2 && (
                    <div className="border rounded-md p-2 max-h-48 overflow-y-auto">
                      {productSearchLoading ? (
                        <div className="text-sm text-muted-foreground">{t("common.searching")}</div>
                      ) : productSearchResults.length === 0 ? (
                        <div className="text-sm text-muted-foreground">{t("common.noResults")}</div>
                      ) : (
                        <div className="space-y-1">
                          {productSearchResults.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              className="w-full text-left text-sm rounded-md px-2 py-1 hover:bg-muted"
                              onClick={() => {
                                if (activeItemIndex === null) return;
                                updateItem(activeItemIndex, { productNumber: product.productNumber });
                              }}
                            >
                              {product.name} ({product.productNumber})
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("bundles.searchHint")}
                  </p>
                </div>
              <div className="space-y-2">
                {formState.items.map((item, index) => (
                  <div key={`${item.productNumber}-${index}`} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-7">
                      <Input
                        placeholder={t("bundles.fields.productNumber")}
                        value={item.productNumber}
                        onChange={(event) => updateItem(index, { productNumber: event.target.value })}
                          onFocus={() => setActiveItemIndex(index)}
                      />
                    </div>
                    <div className="col-span-3">
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          updateItem(index, { quantity: Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 1 });
                        }}
                      />
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItemRow(index)}
                        disabled={formState.items.length <= 1}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => saveBundleMutation.mutate()} disabled={saveBundleMutation.isPending}>
              {saveBundleMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
