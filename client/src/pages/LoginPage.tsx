import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import metaLogoUrl from "@assets/META-Logo.svg";

const MetaLogo = () => (
  <img src={metaLogoUrl} alt="META" className="h-16 w-auto mx-auto mb-6" />
);

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

const emergencyResetSchema = z
  .object({
    username: z.string().min(1, "Benutzername erforderlich"),
    resetKey: z.string().min(1, "Reset-Schlüssel erforderlich"),
    newPassword: z.string().min(8, "Mindestens 8 Zeichen"),
    confirmPassword: z.string().min(1, "Bestätigung erforderlich"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwörter stimmen nicht überein",
    path: ["confirmPassword"],
  });

type EmergencyResetFormData = z.infer<typeof emergencyResetSchema>;

// Versteckter Notfall-Reset: nirgends verlinkt, nur über Ctrl+Shift+Alt+R
// erreichbar. Serverseitig nur wirksam, wenn ADMIN_RESET_KEY gesetzt ist.
function EmergencyResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();

  const form = useForm<EmergencyResetFormData>({
    resolver: zodResolver(emergencyResetSchema),
    defaultValues: {
      username: "",
      resetKey: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (data: EmergencyResetFormData) => {
      const response = await apiRequest("POST", "/api/auth/emergency-reset", {
        username: data.username,
        resetKey: data.resetKey,
        newPassword: data.newPassword,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Passwort zurückgesetzt",
        description: "Sie können sich jetzt mit dem neuen Passwort anmelden.",
      });
      form.reset();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Reset fehlgeschlagen",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Notfall-Passwort-Reset</DialogTitle>
          <DialogDescription>
            Setzt das Passwort eines Benutzers mit dem hinterlegten Reset-Schlüssel zurück.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => resetMutation.mutate(data))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Benutzername</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" data-testid="input-reset-username" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="resetKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reset-Schlüssel</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" autoComplete="off" data-testid="input-reset-key" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Neues Passwort</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" autoComplete="new-password" data-testid="input-reset-new-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Neues Passwort bestätigen</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" autoComplete="new-password" data-testid="input-reset-confirm-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={resetMutation.isPending}
              data-testid="button-reset-password"
            >
              {resetMutation.isPending ? "Wird zurückgesetzt…" : "Passwort zurücksetzen"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function LoginPage({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  // Versteckte Tastenkombination Ctrl+Shift+Alt+R öffnet den Notfall-Reset
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.altKey && event.code === "KeyR") {
        event.preventDefault();
        setResetDialogOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginFormData) => {
      const response = await apiRequest("POST", "/api/auth/login", data);
      return response.json();
    },
    onSuccess: () => {
      // Token is now stored in httpOnly cookie by backend, no client-side storage needed
      // Invalidate auth query to trigger re-fetch and show navigation
      onLoginSuccess();
      toast({
        title: t("auth.loginSuccess"),
        description: t("auth.welcomeBack"),
      });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: t("auth.loginFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: LoginFormData) => {
    loginMutation.mutate(data);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md">
        <MetaLogo />
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">
              {t("auth.login")}
            </CardTitle>
            <CardDescription className="text-center">
              {t("auth.loginDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("auth.username")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("auth.usernamePlaceholder")}
                          autoComplete="username"
                          data-testid="input-username"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("auth.password")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder={t("auth.passwordPlaceholder")}
                          autoComplete="current-password"
                          data-testid="input-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loginMutation.isPending}
                  data-testid="button-login"
                >
                  {loginMutation.isPending ? t("auth.loggingIn") : t("auth.login")}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
      <EmergencyResetDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen} />
    </div>
  );
}
