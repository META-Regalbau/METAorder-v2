import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Loader2, User, Lock } from "lucide-react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { User as UserType, Role } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

type UserWithPermissions = UserType & {
  permissions: Role['permissions'];
};

const profileSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email format"),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Password confirmation is required"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export default function ProfilePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ user: UserWithPermissions }>({
    queryKey: ["/api/auth/me"],
  });

  const user = data?.user;
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "default">("default");

  const { data: pushSettings } = useQuery<{
    enabled: boolean;
    subscription: any | null;
    publicKey?: string | null;
  }>({
    queryKey: ["/api/notifications/push-settings"],
    retry: false,
  });

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      username: "",
      email: "",
    },
  });

  const passwordForm = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (user) {
      profileForm.reset({
        username: user.username || "",
        email: user.email || "",
      });
    }
  }, [user, profileForm]);

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setPushPermission(Notification.permission);
    }
  }, []);

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: z.infer<typeof profileSchema>) => {
      const updates: { username?: string; email?: string } = {};
      
      if (data.username !== user?.username) {
        updates.username = data.username;
      }
      if (data.email !== user?.email) {
        updates.email = data.email;
      }

      if (Object.keys(updates).length === 0) {
        throw new Error("No changes to save");
      }

      return await apiRequest("PUT", "/api/profile", updates);
    },
    onSuccess: () => {
      toast({
        title: t("profile.profileUpdated"),
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: any) => {
      toast({
        title: t("profile.error"),
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  // Update password mutation
  const updatePasswordMutation = useMutation({
    mutationFn: async (data: z.infer<typeof passwordSchema>) => {
      return await apiRequest("PUT", "/api/profile/password", data);
    },
    onSuccess: () => {
      toast({
        title: t("profile.passwordUpdated"),
        variant: "default",
      });
      passwordForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: t("profile.error"),
        description: error.message || "Failed to update password",
        variant: "destructive",
      });
    },
  });

  const updatePushSettingsMutation = useMutation({
    mutationFn: async (payload: { enabled: boolean; subscription?: any | null }) => {
      if (payload.enabled) {
        return await apiRequest("POST", "/api/notifications/push-settings", payload);
      }
      return await apiRequest("DELETE", "/api/notifications/push-settings");
    },
    onSuccess: () => {
      toast({
        title: t("profile.pushSaved"),
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/push-settings"] });
    },
    onError: (error: any) => {
      toast({
        title: t("profile.pushError"),
        description: error.message || "Failed to update push settings",
        variant: "destructive",
      });
    },
  });

  const handleProfileSubmit = (data: z.infer<typeof profileSchema>) => {
    updateProfileMutation.mutate(data);
  };

  const handlePasswordSubmit = (data: z.infer<typeof passwordSchema>) => {
    updatePasswordMutation.mutate(data);
  };

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const handlePushToggle = async (enabled: boolean) => {
    if (!enabled) {
      updatePushSettingsMutation.mutate({ enabled: false, subscription: null });
      return;
    }
    if (!pushSettings?.publicKey) {
      toast({
        title: t("profile.pushError"),
        description: t("profile.pushMissingKey"),
        variant: "destructive",
      });
      return;
    }
    if (!("serviceWorker" in navigator)) {
      toast({
        title: t("profile.pushError"),
        description: t("profile.pushUnsupported"),
        variant: "destructive",
      });
      return;
    }
    const permission = await Notification.requestPermission();
    setPushPermission(permission);
    if (permission !== "granted") {
      toast({
        title: t("profile.pushError"),
        description: t("profile.pushPermissionDenied"),
        variant: "destructive",
      });
      return;
    }

    try {
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      if (!registration.active) {
        throw new Error("Service Worker not active");
      }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushSettings.publicKey),
        });
      }

      updatePushSettingsMutation.mutate({ enabled: true, subscription });
    } catch (error) {
      toast({
        title: t("profile.pushError"),
        description: t("profile.pushUnsupported"),
        variant: "destructive",
      });
    }
  };

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">
          {t("profile.title")}
        </h1>
        <p className="text-muted-foreground mt-1" data-testid="text-page-description">
          {t("profile.description")}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Personal Information */}
        <Card data-testid="card-personal-info">
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5" />
              <CardTitle>{t("profile.personalInfo")}</CardTitle>
            </div>
            <CardDescription>{t("profile.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...profileForm}>
              <form onSubmit={profileForm.handleSubmit(handleProfileSubmit)} className="space-y-4">
                <FormField
                  control={profileForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("profile.username")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          data-testid="input-username"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={profileForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("profile.email")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          data-testid="input-email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <Button 
                  type="submit" 
                  data-testid="button-update-profile"
                  disabled={updateProfileMutation.isPending}
                >
                  {updateProfileMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("profile.updating")}
                    </>
                  ) : (
                    t("profile.updateProfile")
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Password */}
        <Card data-testid="card-security">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              <CardTitle>{t("profile.security")}</CardTitle>
            </div>
            <CardDescription>{t("profile.updatePassword")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...passwordForm}>
              <form onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)} className="space-y-4">
                <FormField
                  control={passwordForm.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("profile.currentPassword")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          data-testid="input-current-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={passwordForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("profile.newPassword")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          data-testid="input-new-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={passwordForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("profile.confirmPassword")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          data-testid="input-confirm-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <Button 
                  type="submit" 
                  data-testid="button-update-password"
                  disabled={updatePasswordMutation.isPending}
                >
                  {updatePasswordMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("profile.updating")}
                    </>
                  ) : (
                    t("profile.updatePassword")
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card data-testid="card-push-settings">
          <CardHeader>
            <CardTitle>{t("profile.pushTitle")}</CardTitle>
            <CardDescription>{t("profile.pushDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t("profile.pushToggle")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("profile.pushPermission", { status: pushPermission })}
                </div>
              </div>
              <Switch
                checked={Boolean(pushSettings?.enabled)}
                onCheckedChange={handlePushToggle}
                data-testid="switch-push-enabled"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
