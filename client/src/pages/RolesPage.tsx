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
import type { Role } from "@shared/schema";

// TODO: Remove mock data - this is for prototype only
const mockRoles: Role[] = [
  {
    id: "1",
    name: "Administrator",
    permissions: {
      viewOrders: true,
      editOrders: true,
      exportData: true,
      viewAnalytics: true,
      manageUsers: true,
      manageRoles: true,
      manageSettings: true,
    },
  },
  {
    id: "2",
    name: "Employee",
    permissions: {
      viewOrders: true,
      editOrders: true,
      exportData: false,
      viewAnalytics: false,
      manageUsers: false,
      manageRoles: false,
      manageSettings: false,
    },
  },
  {
    id: "3",
    name: "Warehouse Manager",
    permissions: {
      viewOrders: true,
      editOrders: true,
      exportData: true,
      viewAnalytics: true,
      manageUsers: false,
      manageRoles: false,
      manageSettings: false,
    },
  },
];

export default function RolesPage() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<Role[]>(mockRoles);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  const handleAddRole = (roleData: { name: string; permissions: Role["permissions"] }) => {
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
        ? { ...role, name: data.name, permissions: data.permissions }
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
          <h1 className="text-2xl font-semibold mb-1">Role Management</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage roles with custom permissions
          </p>
        </div>
        <AddRoleDialog onAddRole={handleAddRole} />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-medium">Role Name</TableHead>
              <TableHead className="font-medium">Permissions</TableHead>
              <TableHead className="font-medium">View Orders</TableHead>
              <TableHead className="font-medium">Edit Orders</TableHead>
              <TableHead className="font-medium">Export Data</TableHead>
              <TableHead className="font-medium">Analytics</TableHead>
              <TableHead className="font-medium">Manage Users</TableHead>
              <TableHead className="font-medium">Manage Roles</TableHead>
              <TableHead className="font-medium">Settings</TableHead>
              <TableHead className="font-medium text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role.id} className="hover-elevate" data-testid={`row-role-${role.id}`}>
                <TableCell className="font-medium" data-testid={`text-role-name-${role.id}`}>
                  {role.name}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {permissionCount(role.permissions)} of 7
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  {role.permissions.viewOrders ? (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground mx-auto" />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {role.permissions.editOrders ? (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground mx-auto" />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {role.permissions.exportData ? (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground mx-auto" />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {role.permissions.viewAnalytics ? (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground mx-auto" />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {role.permissions.manageUsers ? (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground mx-auto" />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {role.permissions.manageRoles ? (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground mx-auto" />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {role.permissions.manageSettings ? (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground mx-auto" />
                  )}
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
            ))}
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
