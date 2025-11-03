import { useState } from "react";
import { Edit, Trash2, Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Role, SalesChannel } from "@shared/schema";

export default function RolesPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ['/api/roles'],
  });

  const { data: salesChannels = [] } = useQuery<SalesChannel[]>({
    queryKey: ['/api/sales-channels'],
  });

  const createRoleMutation = useMutation({
    mutationFn: async (roleData: { name: string; salesChannelIds: string[]; permissions: Role["permissions"] }) => {
      const response = await apiRequest("POST", "/api/roles", roleData);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create role");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/roles'] });
      toast({
        title: t('roles.roleCreated'),
        description: t('roles.roleCreatedSuccess'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('errors.failed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await apiRequest("PATCH", `/api/roles/${id}`, data);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update role");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/roles'] });
      toast({
        title: t('roles.roleUpdated'),
        description: t('roles.roleUpdatedSuccess'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('errors.failed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/roles/${id}`, {});
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete role");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/roles'] });
      toast({
        title: t('roles.roleDeleted'),
        description: t('roles.roleDeletedSuccess'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('errors.failed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddRole = (roleData: { name: string; salesChannelIds: string[]; permissions: Role["permissions"] }) => {
    createRoleMutation.mutate(roleData);
  };

  const handleUpdateRole = (id: string, data: any) => {
    updateRoleMutation.mutate({ id, data });
  };

  const handleDeleteRole = (role: Role) => {
    deleteRoleMutation.mutate(role.id);
    setDeletingRole(null);
  };

  const handleEditClick = (role: Role) => {
    setEditingRole(role);
    setIsEditDialogOpen(true);
  };

  const permissionCount = (permissions: Role["permissions"]) => {
    return Object.values(permissions).filter(Boolean).length;
  };

  if (rolesLoading) {
    return (
      <div className="w-full max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold mb-1">{t('roles.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('roles.description')}</p>
        </div>
        <Card className="p-6">
          <p className="text-center text-muted-foreground">{t('common.loading')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto">
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
                    <div className="flex items-center gap-2">
                      <span className="text-sm">
                        {permissionCount(role.permissions)} / {Object.keys(role.permissions).length}
                      </span>
                      <span className="text-xs text-muted-foreground">{t('roles.enabled')}</span>
                    </div>
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
              This will permanently delete the role "{deletingRole?.name}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-role">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingRole && handleDeleteRole(deletingRole)}
              className={cn(buttonVariants({ variant: "destructive" }))}
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
