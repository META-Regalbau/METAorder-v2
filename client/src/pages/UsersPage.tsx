import { useState } from "react";
import { Edit, Trash2 } from "lucide-react";
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
import AddUserDialog from "@/components/AddUserDialog";
import EditUserDialog from "@/components/EditUserDialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User, Role, SalesChannel } from "@shared/schema";

type UserWithRole = User & { roleId: string; roleName: string };

export default function UsersPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserWithRole | null>(null);

  const { data: users = [], isLoading: usersLoading } = useQuery<UserWithRole[]>({
    queryKey: ['/api/users'],
  });

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ['/api/roles'],
  });

  const { data: salesChannels = [] } = useQuery<SalesChannel[]>({
    queryKey: ['/api/sales-channels'],
  });

  const createUserMutation = useMutation({
    mutationFn: async (userData: { username: string; email?: string; password: string; roleId: string; salesChannelIds: string[] }) => {
      const response = await apiRequest("POST", "/api/users", userData);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create user");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: t('users.userCreated'),
        description: t('users.userCreatedSuccess'),
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

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await apiRequest("PATCH", `/api/users/${id}`, data);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update user");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: t('users.userUpdated'),
        description: t('users.userUpdatedSuccess'),
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

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/users/${id}`, {});
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete user");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: t('users.userDeleted'),
        description: t('users.userDeletedSuccess'),
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

  const handleAddUser = (userData: { username: string; email?: string; password: string; roleId: string; salesChannelIds: string[] }) => {
    createUserMutation.mutate(userData);
  };

  const handleUpdateUser = (id: string, data: any) => {
    updateUserMutation.mutate({ id, data });
  };

  const handleDeleteUser = (user: UserWithRole) => {
    deleteUserMutation.mutate(user.id);
    setDeletingUser(null);
  };

  const handleEditClick = (user: UserWithRole) => {
    setEditingUser(user);
    setIsEditDialogOpen(true);
  };

  if (usersLoading || rolesLoading) {
    return (
      <div className="w-full max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold mb-1">{t('users.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('users.description')}</p>
        </div>
        <Card className="p-6">
          <p className="text-center text-muted-foreground">{t('common.loading')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">{t('users.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('users.description')}
          </p>
        </div>
        <AddUserDialog onAddUser={handleAddUser} availableRoles={roles} />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-medium">{t('users.username')}</TableHead>
              <TableHead className="font-medium">{t('users.email')}</TableHead>
              <TableHead className="font-medium">{t('users.role')}</TableHead>
              <TableHead className="font-medium">{t('users.salesChannels')}</TableHead>
              <TableHead className="font-medium text-right">{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const userChannels = salesChannels.filter(c => user.salesChannelIds?.includes(c.id));
              
              return (
                <TableRow key={user.id} className="hover-elevate" data-testid={`row-user-${user.id}`}>
                  <TableCell className="font-medium" data-testid={`text-username-${user.id}`}>
                    {user.username}
                  </TableCell>
                  <TableCell className="text-sm" data-testid={`text-email-${user.id}`}>
                    {user.email || <span className="text-muted-foreground italic">{t('users.noEmail')}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={user.roleName === "Administrator" ? "default" : "secondary"}
                      data-testid={`badge-role-${user.id}`}
                    >
                      {user.roleName}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {!user.salesChannelIds || user.salesChannelIds.length === 0 ? (
                      <span className="text-sm text-muted-foreground">{t('users.allChannels')}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {userChannels.map(channel => (
                          <Badge key={channel.id} variant="outline" className="text-xs">
                            {channel.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditClick(user)}
                        data-testid={`button-edit-user-${user.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingUser(user)}
                        data-testid={`button-delete-user-${user.id}`}
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

      <EditUserDialog
        user={editingUser}
        open={isEditDialogOpen}
        onClose={() => {
          setIsEditDialogOpen(false);
          setEditingUser(null);
        }}
        onUpdateUser={handleUpdateUser}
        availableRoles={roles}
      />

      <AlertDialog open={!!deletingUser} onOpenChange={() => setDeletingUser(null)}>
        <AlertDialogContent data-testid="dialog-delete-user">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the user "{deletingUser?.username}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-user">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingUser && handleDeleteUser(deletingUser)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-user"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
