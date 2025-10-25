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
import type { User } from "@shared/schema";

// TODO: Remove mock data - this is for prototype only
const mockUsers: User[] = [
  {
    id: "1",
    username: "admin",
    password: "***",
    role: "admin",
  },
  {
    id: "2",
    username: "john_doe",
    password: "***",
    role: "employee",
  },
  {
    id: "3",
    username: "jane_smith",
    password: "***",
    role: "employee",
  },
];

export default function UsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>(mockUsers);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);

  const handleAddUser = (userData: { username: string; password: string; role: string }) => {
    const newUser: User = {
      id: String(users.length + 1),
      ...userData,
    };
    setUsers([...users, newUser]);
    console.log("User added:", newUser);
    // TODO: Implement API call to create user
  };

  const handleUpdateUser = (id: string, data: any) => {
    setUsers(users.map(user => 
      user.id === id 
        ? { ...user, username: data.username, role: data.role }
        : user
    ));
    console.log("User updated:", id, data);
    // TODO: Implement API call to update user
  };

  const handleDeleteUser = (user: User) => {
    setUsers(users.filter(u => u.id !== user.id));
    toast({
      title: "User deleted",
      description: `User ${user.username} has been deleted.`,
    });
    setDeletingUser(null);
    console.log("User deleted:", user.id);
    // TODO: Implement API call to delete user
  };

  const handleEditClick = (user: User) => {
    setEditingUser(user);
    setIsEditDialogOpen(true);
  };

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">User Management</h1>
          <p className="text-sm text-muted-foreground">
            Manage users and their roles
          </p>
        </div>
        <AddUserDialog onAddUser={handleAddUser} />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-medium">Username</TableHead>
              <TableHead className="font-medium">Role</TableHead>
              <TableHead className="font-medium">User ID</TableHead>
              <TableHead className="font-medium text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} className="hover-elevate" data-testid={`row-user-${user.id}`}>
                <TableCell className="font-medium" data-testid={`text-username-${user.id}`}>
                  {user.username}
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={user.role === "admin" ? "default" : "secondary"}
                    data-testid={`badge-role-${user.id}`}
                  >
                    {user.role === "admin" ? "Admin" : "Employee"}
                  </Badge>
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
            ))}
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
