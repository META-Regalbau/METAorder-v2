import { useState } from "react";
import { Edit, Trash2, Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import AddRoleDialog from "@/components/AddRoleDialog";
import EditRoleDialog from "@/components/EditRoleDialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { Role, SalesChannel } from "@shared/schema";

// TODO: Remove mock data - this is for prototype only
const mockRoles: Role[] = [
  {
    id: "1",
    name: "Administrator",
    salesChannelIds: [],
    permissions: {
      viewOrders: true,
      editOrders: true,
      exportData: true,
      viewAnalytics: true,
      manageUsers: true,
      manageRoles: true,
      manageSettings: true,
      manageCrossSellingGroups: true,
      manageCrossSellingRules: true,
    },
  },
  {
    id: "2",
    name: "Employee",
    salesChannelIds: [],
    permissions: {
      viewOrders: true,
      editOrders: true,
      exportData: false,
      viewAnalytics: false,
      manageUsers: false,
      manageRoles: false,
      manageSettings: false,
      manageCrossSellingGroups: false,
      manageCrossSellingRules: false,
    },
  },
  {
    id: "3",
    name: "Warehouse Manager",
    salesChannelIds: ["0190b599291076e3beecdfca3d1b1b1b30", "0193595640017e1ab0b5ae3313b4181c"],
    permissions: {
      viewOrders: true,
      editOrders: true,
      exportData: true,
      viewAnalytics: true,
      manageUsers: false,
      manageRoles: false,
      manageSettings: false,
      manageCrossSellingGroups: true,
      manageCrossSellingRules: true,
    },
  },
];

export default function RolesPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [roles, setRoles] = useState<Role[]>(mockRoles);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  const { data: salesChannels = [] } = useQuery<SalesChannel[]>({
    queryKey: ['/api/sales-channels'],
  });

  const handleAddRole = (roleData: { name: string; salesChannelIds: string[]; permissions: Role["permissions"] }) => {
    const newRole: Role = {
      id: String(roles.length + 1),
      ...roleData,
    };
    setRoles([...roles, newRole]);
    console.log("Role added:", newRole);
    // TODO: Implement API call to create role
  };

  const handleUpdateRole = (id: string, data: any) => {
    setRoles(roles.map(role => 
      role.id === id 
        ? { ...role, name: data.name, salesChannelIds: data.salesChannelIds, permissions: data.permissions }
        : role
    ));
    console.log("Role updated:", id, data);
    // TODO: Implement API call to update role
  };

  const handleDeleteRole = (role: Role) => {
    setRoles(roles.filter(r => r.id !== role.id));
    toast({
      title: "Role deleted",
      description: `Role "${role.name}" has been deleted.`,
    });
    setDeletingRole(null);
    console.log("Role deleted:", role.id);
    // TODO: Implement API call to delete role
  };

  const handleEditClick = (role: Role) => {
    setEditingRole(role);
    setIsEditDialogOpen(true);
  };

  const permissionCount = (permissions: Role["permissions"]) => {
    return Object.values(permissions).filter(Boolean).length;
  };

  return (
    <div className="max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">{t('roles.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('roles.description')}
          </p>
        </div>
        <AddRoleDialog onAddRole={handleAddRole} />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-medium">{t('roles.roleName')}</TableHead>
              <TableHead className="font-medium">{t('roles.salesChannels')}</TableHead>
              <TableHead className="font-medium">{t('roles.permissions')}</TableHead>
              <TableHead className="font-medium text-right">{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => {
              const roleChannels = salesChannels.filter(c => role.salesChannelIds?.includes(c.id));
              
              return (
                <TableRow key={role.id} className="hover-elevate" data-testid={`row-role-${role.id}`}>
                  <TableCell className="font-medium" data-testid={`text-role-name-${role.id}`}>
                    {role.name}
                  </TableCell>
                  <TableCell>
                    {!role.salesChannelIds || role.salesChannelIds.length === 0 ? (
                      <span className="text-sm text-muted-foreground">{t('roles.allChannels')}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {roleChannels.map(channel => (
                          <Badge key={channel.id} variant="outline" className="text-xs">
                            {channel.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {permissionCount(role.permissions)} of 7
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditClick(role)}
                      data-testid={`button-edit-role-${role.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingRole(role)}
                      data-testid={`button-delete-role-${role.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
            })}
          </TableBody>
        </Table>
      </Card>

      <EditRoleDialog
        role={editingRole}
        open={isEditDialogOpen}
        onClose={() => {
          setIsEditDialogOpen(false);
          setEditingRole(null);
        }}
        onUpdateRole={handleUpdateRole}
      />

      <AlertDialog open={!!deletingRole} onOpenChange={() => setDeletingRole(null)}>
        <AlertDialogContent data-testid="dialog-delete-role">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the role "{deletingRole?.name}". Users with this role will need to be reassigned. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-role">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingRole && handleDeleteRole(deletingRole)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-role"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
