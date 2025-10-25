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
import { useQuery } from "@tanstack/react-query";
import type { User, Role, SalesChannel } from "@shared/schema";

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

type UserWithRole = User & { roleId: string; roleName: string };

const mockUsers: UserWithRole[] = [
  {
    id: "1",
    username: "admin",
    password: "***",
    role: "admin",
    roleId: "1",
    roleName: "Administrator",
    salesChannelIds: [],
  },
  {
    id: "2",
    username: "john_doe",
    password: "***",
    role: "employee",
    roleId: "2",
    roleName: "Employee",
    salesChannelIds: ["0190b599291076e3beecdfca3d1b1b30"],
  },
  {
    id: "3",
    username: "jane_smith",
    password: "***",
    role: "employee",
    roleId: "3",
    roleName: "Warehouse Manager",
    salesChannelIds: ["0193595640017e1ab0b5ae3313b4181c", "018ec134507f703b82a76467791e7e61"],
  },
];

export default function UsersPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserWithRole[]>(mockUsers);
  const [roles] = useState<Role[]>(mockRoles);
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserWithRole | null>(null);

  const { data: salesChannels = [] } = useQuery<SalesChannel[]>({
    queryKey: ['/api/sales-channels'],
  });

  const handleAddUser = (userData: { username: string; password: string; roleId: string; salesChannelIds: string[] }) => {
    const role = roles.find(r => r.id === userData.roleId);
    const newUser: UserWithRole = {
      id: String(users.length + 1),
      username: userData.username,
      password: userData.password,
      role: role?.name.toLowerCase() === "administrator" ? "admin" : "employee",
      roleId: userData.roleId,
      roleName: role?.name || "",
      salesChannelIds: userData.salesChannelIds,
    };
    setUsers([...users, newUser]);
    console.log("User added:", newUser);
    // TODO: Implement API call to create user
  };

  const handleUpdateUser = (id: string, data: any) => {
    const role = roles.find(r => r.id === data.roleId);
    setUsers(users.map(user => 
      user.id === id 
        ? { 
            ...user, 
            username: data.username, 
            roleId: data.roleId,
            roleName: role?.name || "",
            role: role?.name.toLowerCase() === "administrator" ? "admin" : "employee",
            salesChannelIds: data.salesChannelIds
          }
        : user
    ));
    console.log("User updated:", id, data);
    // TODO: Implement API call to update user
  };

  const handleDeleteUser = (user: UserWithRole) => {
    setUsers(users.filter(u => u.id !== user.id));
    toast({
      title: "User deleted",
      description: `User ${user.username} has been deleted.`,
    });
    setDeletingUser(null);
    console.log("User deleted:", user.id);
    // TODO: Implement API call to delete user
  };

  const handleEditClick = (user: UserWithRole) => {
    setEditingUser(user);
    setIsEditDialogOpen(true);
  };

  return (
    <div className="max-w-6xl">
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
              <TableHead className="font-medium">{t('users.role')}</TableHead>
              <TableHead className="font-medium">{t('users.salesChannels')}</TableHead>
              <TableHead className="font-medium">{t('users.userId')}</TableHead>
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
                  <TableCell className="text-sm text-muted-foreground font-mono">
                    {user.id}
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
