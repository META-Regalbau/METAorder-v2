import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SalesChannelMultiSelect } from "@/components/SalesChannelMultiSelect";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import type { Role } from "@shared/schema";

const editRoleSchema = z.object({
  name: z.string().min(2, "Role name must be at least 2 characters"),
  salesChannelIds: z.array(z.string()),
  permissions: z.object({
    viewOrders: z.boolean(),
    editOrders: z.boolean(),
    exportData: z.boolean(),
    viewAnalytics: z.boolean(),
    viewDelayedOrders: z.boolean(),
    viewShipping: z.boolean(),
    manageUsers: z.boolean(),
    manageRoles: z.boolean(),
    manageSettings: z.boolean(),
    manageCrossSellingGroups: z.boolean(),
    manageCrossSellingRules: z.boolean(),
    viewTickets: z.boolean(),
    manageTickets: z.boolean(),
    manageAutomations: z.boolean(),
    manageOrderDrafts: z.boolean(),
    viewOffers: z.boolean(),
    manageOffers: z.boolean(),
    viewNaturalLanguageAnalytics: z.boolean(),
    viewDocuments: z.boolean(),
    manageDocuments: z.boolean(),
    manageProducts: z.boolean(),
    viewAccounting: z.boolean(),
    viewCrm: z.boolean(),
    manageCrm: z.boolean(),
    approveCrm: z.boolean(),
    viewCPQ: z.boolean(),
    manageCPQ: z.boolean(),
    manageCPQDiscountLevels: z.boolean(),
    approveCPQQuotes: z.boolean(),
  }),
});

type EditRoleFormData = z.infer<typeof editRoleSchema>;

interface EditRoleDialogProps {
  role: Role | null;
  open: boolean;
  onClose: () => void;
  onUpdateRole: (id: string, data: EditRoleFormData) => void;
}

const permissionLabels = {
  viewOrders: { label: "View Orders", description: "Can view order list and details" },
  editOrders: { label: "Edit Orders", description: "Can add shipping info and update order status" },
  exportData: { label: "Export Data", description: "Can export orders and reports" },
  viewAnalytics: { label: "View Analytics", description: "Can access analytics dashboard" },
  viewDelayedOrders: { label: "View Delayed Orders", description: "Can view and manage delayed orders" },
  viewShipping: { label: "View Shipping", description: "Can access shipping dashboard for ready-to-ship orders" },
  manageUsers: { label: "Manage Users", description: "Can create, edit, and delete users" },
  manageRoles: { label: "Manage Roles", description: "Can create, edit, and delete roles" },
  manageSettings: { label: "Manage Settings", description: "Can configure Shopware API and system settings" },
  manageCrossSellingGroups: { label: "Manage Cross-Selling Groups", description: "Can create and manage product cross-selling groups" },
  manageCrossSellingRules: { label: "Manage Cross-Selling Rules", description: "Can create and manage intelligent cross-selling rules" },
  viewTickets: { label: "View Tickets", description: "Can view ticket list and details" },
  manageTickets: { label: "Manage Tickets", description: "Can create, edit, assign, and delete tickets" },
  manageAutomations: { label: "Manage Automations", description: "Can create and manage automation rules" },
  manageOrderDrafts: { label: "Manage Order Drafts", description: "Can upload and process order drafts" },
  viewOffers: { label: "View Offers", description: "Can view offers and offer details" },
  manageOffers: { label: "Manage Offers", description: "Can upload offer drafts and create offers" },
  viewNaturalLanguageAnalytics: { label: "View Natural Language Analytics", description: "Can use natural language analytics queries" },
  viewDocuments: { label: "View Documents", description: "Can access documents and files" },
  manageDocuments: { label: "Manage Documents", description: "Can upload and manage documents" },
  manageProducts: { label: "Manage Products", description: "Can activate and deactivate products" },
  viewAccounting: { label: "View Accounting", description: "Can access accounting uploads and matching" },
  viewCrm: { label: "View CRM", description: "Can access CRM pages and customer views" },
  manageCrm: { label: "Manage CRM", description: "Can create CRM requests and customer notes" },
  approveCrm: { label: "Approve CRM", description: "Can approve discounts and assignments" },
  viewCPQ: { label: "View CPQ", description: "Can view configurator and configurations" },
  manageCPQ: { label: "Manage CPQ", description: "Can manage rules, mappings, and systems" },
  manageCPQDiscountLevels: { label: "Manage CPQ Discount Levels", description: "Can manage discount traffic light levels" },
  approveCPQQuotes: { label: "Approve CPQ Quotes", description: "Can approve offers requiring clearance" },
};

export default function EditRoleDialog({ role, open, onClose, onUpdateRole }: EditRoleDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();

  const form = useForm<EditRoleFormData>({
    resolver: zodResolver(editRoleSchema),
    values: role ? {
      name: role.name,
      salesChannelIds: role.salesChannelIds || [],
      permissions: {
        viewOrders: !!role.permissions.viewOrders,
        editOrders: !!role.permissions.editOrders,
        exportData: !!role.permissions.exportData,
        viewAnalytics: !!role.permissions.viewAnalytics,
        viewDelayedOrders: !!role.permissions.viewDelayedOrders,
        viewShipping: !!role.permissions.viewShipping,
        manageUsers: !!role.permissions.manageUsers,
        manageRoles: !!role.permissions.manageRoles,
        manageSettings: !!role.permissions.manageSettings,
        manageCrossSellingGroups: !!role.permissions.manageCrossSellingGroups,
        manageCrossSellingRules: !!role.permissions.manageCrossSellingRules,
        viewTickets: !!role.permissions.viewTickets,
        manageTickets: !!role.permissions.manageTickets,
        manageAutomations: !!role.permissions.manageAutomations,
        manageOrderDrafts: !!role.permissions.manageOrderDrafts,
        viewOffers: !!role.permissions.viewOffers,
        manageOffers: !!role.permissions.manageOffers,
        viewNaturalLanguageAnalytics: !!role.permissions.viewNaturalLanguageAnalytics,
        viewDocuments: !!role.permissions.viewDocuments,
        manageDocuments: !!role.permissions.manageDocuments,
        manageProducts: !!role.permissions.manageProducts,
        viewAccounting: !!role.permissions.viewAccounting,
        viewCrm: !!role.permissions.viewCrm,
        manageCrm: !!role.permissions.manageCrm,
        approveCrm: !!role.permissions.approveCrm,
        viewCPQ: !!(role.permissions as any).viewCPQ,
        manageCPQ: !!(role.permissions as any).manageCPQ,
        manageCPQDiscountLevels: !!(role.permissions as any).manageCPQDiscountLevels,
        approveCPQQuotes: !!(role.permissions as any).approveCPQQuotes,
      },
    } : undefined,
  });

  const handleSubmit = (data: EditRoleFormData) => {
    if (!role) return;
    
    console.log("Updating role:", role.id, data);
    onUpdateRole(role.id, data);
    toast({
      title: "Role updated",
      description: `Role "${data.name}" has been updated successfully.`,
    });
    onClose();
  };

  if (!role) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col" data-testid="dialog-edit-role">
        <DialogHeader>
          <DialogTitle>Edit Role</DialogTitle>
          <DialogDescription>{t("roles.description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col flex-1 min-h-0 gap-4">
            <div className="space-y-4 overflow-y-auto pr-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-medium">Role Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Warehouse Manager" {...field} data-testid="input-edit-role-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="salesChannelIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-medium">{t('roles.salesChannels')}</FormLabel>
                    <FormControl>
                      <SalesChannelMultiSelect
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3">
                <h3 className="text-sm font-medium">Permissions</h3>
                <div className="space-y-3 pl-2">
                  {(Object.keys(permissionLabels) as Array<keyof typeof permissionLabels>).map((key) => (
                    <FormField
                      key={key}
                      control={form.control}
                      name={`permissions.${key}`}
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid={`checkbox-edit-permission-${key}`}
                            />
                          </FormControl>
                          <div className="space-y-0.5 leading-none">
                            <FormLabel className="font-medium cursor-pointer">
                              {permissionLabels[key].label}
                            </FormLabel>
                            <FormDescription className="text-xs">
                              {permissionLabels[key].description}
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-edit-role">
                {t('common.cancel')}
              </Button>
              <Button type="submit" data-testid="button-submit-edit-role">
                {t('roles.updateRole')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
