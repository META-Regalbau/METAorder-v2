import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SalesChannelMultiSelect } from "@/components/SalesChannelMultiSelect";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { useState } from "react";

const addRoleSchema = z.object({
  name: z.string().min(2, "Role name must be at least 2 characters"),
  salesChannelIds: z.array(z.string()),
  permissions: z.object({
    viewOrders: z.boolean(),
    editOrders: z.boolean(),
    exportData: z.boolean(),
    viewAnalytics: z.boolean(),
    manageUsers: z.boolean(),
    manageRoles: z.boolean(),
    manageSettings: z.boolean(),
  }),
});

type AddRoleFormData = z.infer<typeof addRoleSchema>;

interface AddRoleDialogProps {
  onAddRole: (role: AddRoleFormData) => void;
}

const permissionLabels = {
  viewOrders: { label: "View Orders", description: "Can view order list and details" },
  editOrders: { label: "Edit Orders", description: "Can add shipping info and update order status" },
  exportData: { label: "Export Data", description: "Can export orders and reports" },
  viewAnalytics: { label: "View Analytics", description: "Can access analytics dashboard" },
  manageUsers: { label: "Manage Users", description: "Can create, edit, and delete users" },
  manageRoles: { label: "Manage Roles", description: "Can create, edit, and delete roles" },
  manageSettings: { label: "Manage Settings", description: "Can configure Shopware API and system settings" },
};

export default function AddRoleDialog({ onAddRole }: AddRoleDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const form = useForm<AddRoleFormData>({
    resolver: zodResolver(addRoleSchema),
    defaultValues: {
      name: "",
      salesChannelIds: [],
      permissions: {
        viewOrders: true,
        editOrders: false,
        exportData: false,
        viewAnalytics: false,
        manageUsers: false,
        manageRoles: false,
        manageSettings: false,
      },
    },
  });

  const handleSubmit = (data: AddRoleFormData) => {
    console.log("Adding role:", data);
    onAddRole(data);
    toast({
      title: "Role created",
      description: `Role "${data.name}" has been created successfully.`,
    });
    form.reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-role">
          <Shield className="h-4 w-4 mr-1" />
          Add Role
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl" data-testid="dialog-add-role">
        <DialogHeader>
          <DialogTitle>Add New Role</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-medium">Role Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Warehouse Manager" {...field} data-testid="input-role-name" />
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
                            data-testid={`checkbox-permission-${key}`}
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
            
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-add-role">
                {t('common.cancel')}
              </Button>
              <Button type="submit" data-testid="button-submit-add-role">
                {t('roles.createRole')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
