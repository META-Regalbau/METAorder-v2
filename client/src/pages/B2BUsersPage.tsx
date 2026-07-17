import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Download,
  Eye,
  FileSpreadsheet,
  FileUp,
  Mail,
  Play,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, readJsonBody } from "@/lib/queryClient";
import type { Role, SalesChannel } from "@shared/schema";

type PortalUserType = "company" | "dealer" | "sales_rep";

type CustomerGroup = { id: string; name: string };
type EmployeeRole = { id: string; name: string; technicalName?: string | null };
type CompanyOption = { id: string; customerId: string | null; company: string; email: string };

type PortalUserVerifyResult = {
  email: string;
  type: PortalUserType;
  overall: "pass" | "fail" | "warn";
  checks: Array<{
    id: string;
    label: string;
    status: "pass" | "fail" | "warn" | "skip";
    message: string;
  }>;
  login: { attempted: boolean; success: boolean; message: string };
};

type ImportRowResult = {
  rowNumber?: number;
  firstName: string;
  lastName: string;
  email: string;
  type: PortalUserType;
  isSupervisor: boolean;
  status: "would_create" | "created" | "skipped_duplicate" | "would_update" | "updated" | "error";
  customerId?: string;
  employeeId?: string;
  message?: string;
  verify?: PortalUserVerifyResult;
};

type ImportResult = {
  mode: "apply" | "dry-run";
  totalRows: number;
  created: number;
  wouldCreate: number;
  updated: number;
  wouldUpdate: number;
  skippedDuplicate: number;
  errors: number;
  rows: ImportRowResult[];
  parseErrors?: Array<{ rowNumber: number; message: string }>;
};

interface B2BUsersPageProps {
  userPermissions: Role["permissions"];
  userRole: "employee" | "admin";
  userSalesChannelIds?: string[] | null;
}

const DEFAULT_ADDRESS = {
  company: "META",
  street: "Hüstener Straße 58",
  zipCode: "59759",
  city: "Arnsberg",
  country: "DE",
};

const singleUserSchema = z
  .object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    password: z.string(),
    confirmPassword: z.string(),
    type: z.enum(["company", "dealer", "sales_rep"]),
    isSupervisor: z.boolean(),
    groupIdCompany: z.string().min(1),
    groupIdDealer: z.string().min(1),
    groupIdSalesRep: z.string().min(1),
    salesChannelId: z.string().min(1),
    metaCompanyCustomerId: z.string().optional(),
    supervisorRoleId: z.string().optional(),
    addressCompany: z.string().optional(),
    addressStreet: z.string().min(1),
    addressZipCode: z.string().min(1),
    addressCity: z.string().min(1),
    addressCountry: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine((data) => !data.password || data.password.length >= 6, {
    message: "Password min 6",
    path: ["password"],
  })
  .superRefine((data, ctx) => {
    if (data.type === "sales_rep" && !data.metaCompanyCustomerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "META company required",
        path: ["metaCompanyCustomerId"],
      });
    }
    if (data.type === "sales_rep" && data.isSupervisor && !data.supervisorRoleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Supervisor role required",
        path: ["supervisorRoleId"],
      });
    }
  });

type SingleUserFormData = z.infer<typeof singleUserSchema>;

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

const STATUS_VARIANT: Record<ImportRowResult["status"], "default" | "secondary" | "destructive" | "outline"> = {
  would_create: "default",
  created: "default",
  would_update: "secondary",
  updated: "secondary",
  skipped_duplicate: "outline",
  error: "destructive",
};

const VERIFY_VARIANT: Record<PortalUserVerifyResult["overall"], "default" | "secondary" | "destructive" | "outline"> = {
  pass: "default",
  warn: "secondary",
  fail: "destructive",
};

const CHECK_STATUS_VARIANT: Record<
  PortalUserVerifyResult["checks"][number]["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pass: "default",
  warn: "secondary",
  fail: "destructive",
  skip: "outline",
};

export default function B2BUsersPage({ userPermissions, userRole, userSalesChannelIds }: B2BUsersPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canView = userPermissions?.viewB2B;
  const canManage = userPermissions?.manageB2B;

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importUpdateExisting, setImportUpdateExisting] = useState(true);
  const [singleUpdateExisting, setSingleUpdateExisting] = useState(false);
  const [importPassword, setImportPassword] = useState("");
  const [importDefaultType, setImportDefaultType] = useState<PortalUserType>("sales_rep");
  const [importDefaultSupervisor, setImportDefaultSupervisor] = useState(false);
  const [importGroupIdCompany, setImportGroupIdCompany] = useState("");
  const [importGroupIdDealer, setImportGroupIdDealer] = useState("");
  const [importGroupIdSalesRep, setImportGroupIdSalesRep] = useState("");
  const [importSalesChannelId, setImportSalesChannelId] = useState("");
  const [importMetaCompanyCustomerId, setImportMetaCompanyCustomerId] = useState("");
  const [importSupervisorRoleId, setImportSupervisorRoleId] = useState("");
  const [importAddress, setImportAddress] = useState(DEFAULT_ADDRESS);
  const [importLoading, setImportLoading] = useState<"dry-run" | "apply" | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<PortalUserVerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [sendEmails, setSendEmails] = useState(false);

  const { data: portalUserSettingsData } = useQuery<{ settings: { sendEmails: boolean } }>({
    queryKey: ["/api/b2b/portal-users/settings"],
    enabled: canView,
  });

  useEffect(() => {
    if (portalUserSettingsData?.settings) {
      setSendEmails(portalUserSettingsData.settings.sendEmails);
    }
  }, [portalUserSettingsData?.settings?.sendEmails]);

  const savePortalUserSettingsMutation = useMutation({
    mutationFn: async (nextSendEmails: boolean) => {
      const res = await apiRequest("POST", "/api/b2b/portal-users/settings", {
        sendEmails: nextSendEmails,
      });
      return readJsonBody(res) as Promise<{ settings: { sendEmails: boolean } }>;
    },
    onSuccess: (data) => {
      setSendEmails(data.settings.sendEmails);
      queryClient.setQueryData(["/api/b2b/portal-users/settings"], data);
    },
    onError: (error: Error) => {
      toast({
        title: t("b2b.users.settings.saveErrorTitle"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSendEmailsChange = (checked: boolean) => {
    setSendEmails(checked);
    if (canManage) {
      savePortalUserSettingsMutation.mutate(checked);
    }
  };

  const form = useForm<SingleUserFormData>({
    resolver: zodResolver(singleUserSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      type: "sales_rep",
      isSupervisor: false,
      groupIdCompany: "",
      groupIdDealer: "",
      groupIdSalesRep: "",
      salesChannelId: "",
      metaCompanyCustomerId: "",
      supervisorRoleId: "",
      addressCompany: DEFAULT_ADDRESS.company,
      addressStreet: DEFAULT_ADDRESS.street,
      addressZipCode: DEFAULT_ADDRESS.zipCode,
      addressCity: DEFAULT_ADDRESS.city,
      addressCountry: DEFAULT_ADDRESS.country,
    },
  });

  const selectedType = form.watch("type");
  const isSupervisor = form.watch("isSupervisor");

  const { data: groupsData } = useQuery<{ groups: CustomerGroup[] }>({
    queryKey: ["/api/b2b/customer-groups"],
    enabled: canView,
  });

  const { data: rolesData } = useQuery<{ roles: EmployeeRole[] }>({
    queryKey: ["/api/b2b/roles"],
    enabled: canView,
  });

  const { data: salesChannels = [] } = useQuery<SalesChannel[]>({
    queryKey: ["/api/sales-channels"],
    enabled: canView,
  });

  const availableSalesChannels = useMemo(() => {
    if (userRole === "admin" || !userSalesChannelIds?.length) {
      return salesChannels;
    }
    return salesChannels.filter((channel) => userSalesChannelIds.includes(channel.id));
  }, [salesChannels, userRole, userSalesChannelIds]);

  const { data: companiesData } = useQuery<{ companies: CompanyOption[] }>({
    queryKey: ["/api/b2b/companies", "META"],
    queryFn: async () => {
      const params = new URLSearchParams({ search: "META", limit: "25" });
      const res = await fetch(`/api/b2b/companies?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      if (!text.trim()) throw new Error("Leere Server-Antwort");
      return JSON.parse(text);
    },
    enabled: canView,
  });

  const groups = groupsData?.groups ?? [];
  const roles = rolesData?.roles ?? [];
  const companies = companiesData?.companies ?? [];

  useEffect(() => {
    if (groups.length === 0) return;
    const companyGroup = groups.find((g) => /unternehmen|company|business/i.test(g.name)) ?? groups[0];
    const dealerGroup = groups.find((g) => /händler|haendler|dealer|portal/i.test(g.name)) ?? groups[0];
    const salesGroup = groups.find((g) => /vertrieb|sales|employee|mitarbeiter/i.test(g.name)) ?? groups[0];

    if (!form.getValues("groupIdCompany")) form.setValue("groupIdCompany", companyGroup.id);
    if (!form.getValues("groupIdDealer")) form.setValue("groupIdDealer", dealerGroup.id);
    if (!form.getValues("groupIdSalesRep")) form.setValue("groupIdSalesRep", salesGroup.id);
    if (!importGroupIdCompany) setImportGroupIdCompany(companyGroup.id);
    if (!importGroupIdDealer) setImportGroupIdDealer(dealerGroup.id);
    if (!importGroupIdSalesRep) setImportGroupIdSalesRep(salesGroup.id);
  }, [groups, form, importGroupIdCompany, importGroupIdDealer, importGroupIdSalesRep]);

  useEffect(() => {
    if (availableSalesChannels.length === 0) return;
    const defaultChannelId = availableSalesChannels[0].id;
    if (!form.getValues("salesChannelId")) form.setValue("salesChannelId", defaultChannelId);
    if (!importSalesChannelId) setImportSalesChannelId(defaultChannelId);
  }, [availableSalesChannels, form, importSalesChannelId]);

  useEffect(() => {
    const metaCompany = companies.find((c) => /meta/i.test(c.company));
    const fallback = metaCompany ?? companies[0];
    if (!fallback) return;
    const customerId = fallback.customerId || fallback.id;
    if (!form.getValues("metaCompanyCustomerId")) form.setValue("metaCompanyCustomerId", customerId);
    if (!importMetaCompanyCustomerId) setImportMetaCompanyCustomerId(customerId);
  }, [companies, form, importMetaCompanyCustomerId]);

  useEffect(() => {
    const supervisorRole =
      roles.find((r) => /supervisor|admin|manager|freigabe/i.test(r.name)) ?? roles[0];
    if (!supervisorRole) return;
    if (!form.getValues("supervisorRoleId")) form.setValue("supervisorRoleId", supervisorRole.id);
    if (!importSupervisorRoleId) setImportSupervisorRoleId(supervisorRole.id);
  }, [roles, form, importSupervisorRoleId]);

  const groupIdForType = (type: PortalUserType, values: SingleUserFormData) => {
    if (type === "company") return values.groupIdCompany;
    if (type === "dealer") return values.groupIdDealer;
    return values.groupIdSalesRep;
  };

  const createMutation = useMutation({
    mutationFn: async (values: SingleUserFormData) => {
      const payload = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password || undefined,
        type: values.type,
        isSupervisor: values.type === "sales_rep" ? values.isSupervisor : false,
        groupId: groupIdForType(values.type, values),
        salesChannelId: values.salesChannelId,
        metaCompanyCustomerId: values.type === "sales_rep" ? values.metaCompanyCustomerId : undefined,
        supervisorRoleId:
          values.type === "sales_rep" && values.isSupervisor ? values.supervisorRoleId : undefined,
        address: {
          company: values.addressCompany,
          street: values.addressStreet,
          zipCode: values.addressZipCode,
          city: values.addressCity,
          country: values.addressCountry,
        },
        sendEmails,
      };
      const method = singleUpdateExisting ? "PATCH" : "POST";
      const res = await apiRequest(method, "/api/b2b/portal-users", payload);
      return readJsonBody(res) as Promise<ImportRowResult>;
    },
    onSuccess: (result: ImportRowResult) => {
      if (result.verify) setVerifyResult(result.verify);
      const verifyFailed = result.verify?.overall === "fail";
      toast({
        title: singleUpdateExisting ? t("b2b.users.updateSuccessTitle") : t("b2b.users.createSuccessTitle"),
        description: verifyFailed
          ? result.message || t("b2b.users.verify.failedDescription")
          : singleUpdateExisting
            ? t("b2b.users.updateSuccessDescription")
            : t("b2b.users.createSuccessDescription"),
        variant: verifyFailed ? "destructive" : "default",
      });
      form.reset({
        ...form.getValues(),
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        confirmPassword: "",
        isSupervisor: false,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/companies"] });
    },
    onError: (error: Error) => {
      toast({
        title: t("b2b.users.createErrorTitle"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const typeLabel = (type: PortalUserType) => t(`b2b.users.types.${type}`);

  const statusLabel = (status: ImportRowResult["status"]) =>
    t(`b2b.users.import.status.${status}`, { defaultValue: status });

  const verifyOverallLabel = (overall: PortalUserVerifyResult["overall"]) =>
    t(`b2b.users.verify.overall.${overall}`);

  const runLoginVerify = async (values: SingleUserFormData) => {
    if (values.password.length < 6) {
      form.setError("password", { message: t("b2b.users.fields.passwordMin") });
      return;
    }
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const payload = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
        type: values.type,
        isSupervisor: values.type === "sales_rep" ? values.isSupervisor : false,
        groupId: groupIdForType(values.type, values),
        salesChannelId: values.salesChannelId,
        metaCompanyCustomerId: values.type === "sales_rep" ? values.metaCompanyCustomerId : undefined,
        supervisorRoleId:
          values.type === "sales_rep" && values.isSupervisor ? values.supervisorRoleId : undefined,
        address: {
          company: values.addressCompany,
          street: values.addressStreet,
          zipCode: values.addressZipCode,
          city: values.addressCity,
          country: values.addressCountry,
        },
        sendEmails,
      };
      const res = await apiRequest("POST", "/api/b2b/portal-users/verify", payload);
      const result = (await readJsonBody(res)) as PortalUserVerifyResult;
      setVerifyResult(result);
      if (result.overall === "fail") {
        toast({
          title: t("b2b.users.verify.failedTitle"),
          description: result.login.message || t("b2b.users.verify.failedDescription"),
          variant: "destructive",
        });
      } else {
        toast({
          title: t("b2b.users.verify.successTitle"),
          description: result.login.message || t("b2b.users.verify.successDescription"),
        });
      }
    } catch (error: unknown) {
      toast({
        title: t("b2b.users.verify.failedTitle"),
        description: error instanceof Error ? error.message : t("b2b.users.verify.failedDescription"),
        variant: "destructive",
      });
    } finally {
      setVerifyLoading(false);
    }
  };

  const submitImport = async (apply: boolean) => {
    if (!importFile || !importSalesChannelId) return;
    if (!importUpdateExisting && !importPassword) return;
    setImportLoading(apply ? "apply" : "dry-run");
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("apply", String(apply));
      formData.append("updateExisting", String(importUpdateExisting));
      formData.append("password", importPassword);
      formData.append("defaultType", importDefaultType);
      formData.append("defaultSupervisor", String(importDefaultSupervisor));
      formData.append("groupIdCompany", importGroupIdCompany);
      formData.append("groupIdDealer", importGroupIdDealer);
      formData.append("groupIdSalesRep", importGroupIdSalesRep);
      formData.append("salesChannelId", importSalesChannelId);
      formData.append("metaCompanyCustomerId", importMetaCompanyCustomerId);
      formData.append("supervisorRoleId", importSupervisorRoleId);
      formData.append("addressCompany", importAddress.company || "");
      formData.append("addressStreet", importAddress.street);
      formData.append("addressZipCode", importAddress.zipCode);
      formData.append("addressCity", importAddress.city);
      formData.append("addressCountry", importAddress.country);
      formData.append("sendEmails", String(sendEmails));

      const headers: Record<string, string> = {};
      const csrfToken = getCsrfToken();
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

      const res = await fetch("/api/b2b/portal-users/import", {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
        cache: "no-store",
      });

      const text = (await res.text()) || "";
      if (!res.ok) {
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      if (!text.trim()) {
        throw new Error("Leere Server-Antwort");
      }

      let data: ImportResult;
      try {
        data = JSON.parse(text) as ImportResult;
      } catch {
        throw new Error(`Ungültige JSON-Antwort: ${text.slice(0, 200)}`);
      }
      setImportResult(data);
      if (apply) {
        toast({ title: t("b2b.users.import.appliedToast") });
        queryClient.invalidateQueries({ queryKey: ["/api/b2b/companies"] });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t("b2b.users.import.errorGeneric");
      toast({
        title: t("b2b.users.import.errorTitle"),
        description: message,
        variant: "destructive",
      });
    } finally {
      setImportLoading(null);
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await fetch("/api/b2b/portal-users/template", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "b2b-portal-users-template.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      toast({
        title: t("b2b.users.import.errorTitle"),
        description: error instanceof Error ? error.message : t("b2b.users.import.errorGeneric"),
        variant: "destructive",
      });
    }
  };

  const problemRows = useMemo(
    () =>
      importResult?.rows.filter(
        (row) =>
          row.status === "error" ||
          row.status === "skipped_duplicate" ||
          row.verify?.overall === "fail",
      ) ?? [],
    [importResult],
  );

  const importReady =
    Boolean(importFile) &&
    Boolean(importSalesChannelId) &&
    (importUpdateExisting || importPassword.length >= 6);

  if (!canView) {
    return <div className="p-6 text-muted-foreground">{t("b2b.noPermission")}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <UserPlus className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">{t("b2b.users.title")}</h1>
            <p className="text-muted-foreground">{t("b2b.users.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-lg border p-3 max-w-md">
          <Mail className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{t("b2b.users.settings.sendEmails")}</p>
              <Switch
                checked={sendEmails}
                onCheckedChange={handleSendEmailsChange}
                disabled={!canManage || savePortalUserSettingsMutation.isPending}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("b2b.users.settings.sendEmailsHint")}</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="single">
        <TabsList>
          <TabsTrigger value="single">{t("b2b.users.tabs.single")}</TabsTrigger>
          <TabsTrigger value="import">{t("b2b.users.tabs.import")}</TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("b2b.users.single.title")}</CardTitle>
              <CardDescription>{t("b2b.users.single.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((values) => {
                    if (!singleUpdateExisting && values.password.length < 6) {
                      form.setError("password", { message: t("b2b.users.fields.passwordMin") });
                      return;
                    }
                    createMutation.mutate(values);
                  })}
                  className="grid gap-4 md:grid-cols-2"
                >
                  <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
                    <div>
                      <p className="text-sm font-medium">{t("b2b.users.single.updateExisting")}</p>
                      <p className="text-xs text-muted-foreground">{t("b2b.users.single.updateExistingHint")}</p>
                    </div>
                    <Switch checked={singleUpdateExisting} onCheckedChange={setSingleUpdateExisting} />
                  </div>
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("b2b.users.fields.firstName")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("b2b.users.fields.lastName")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>{t("b2b.email")}</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="salesChannelId"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>{t("b2b.users.fields.salesChannel")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("b2b.users.fields.salesChannelPlaceholder")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {availableSalesChannels.map((channel) => (
                              <SelectItem key={channel.id} value={channel.id}>
                                {channel.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("b2b.users.fields.type")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="company">{typeLabel("company")}</SelectItem>
                            <SelectItem value="dealer">{typeLabel("dealer")}</SelectItem>
                            <SelectItem value="sales_rep">{typeLabel("sales_rep")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {selectedType === "sales_rep" ? (
                    <FormField
                      control={form.control}
                      name="isSupervisor"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border p-3">
                          <div>
                            <FormLabel>{t("b2b.users.fields.supervisor")}</FormLabel>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div />
                  )}
                  <FormField
                    control={form.control}
                    name={selectedType === "company" ? "groupIdCompany" : selectedType === "dealer" ? "groupIdDealer" : "groupIdSalesRep"}
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>{t("b2b.users.fields.customerGroup")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("b2b.users.fields.customerGroupPlaceholder")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {groups.map((group) => (
                              <SelectItem key={group.id} value={group.id}>
                                {group.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {selectedType === "sales_rep" ? (
                    <>
                      <FormField
                        control={form.control}
                        name="metaCompanyCustomerId"
                        render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>{t("b2b.users.fields.metaCompany")}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={t("b2b.users.fields.metaCompanyPlaceholder")} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {companies.map((company) => (
                                  <SelectItem key={company.id} value={company.customerId || company.id}>
                                    {company.company} ({company.email || company.customerId || company.id})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {isSupervisor ? (
                        <FormField
                          control={form.control}
                          name="supervisorRoleId"
                          render={({ field }) => (
                            <FormItem className="md:col-span-2">
                              <FormLabel>{t("b2b.users.fields.supervisorRole")}</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder={t("b2b.users.fields.supervisorRolePlaceholder")} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {roles.map((role) => (
                                    <SelectItem key={role.id} value={role.id}>
                                      {role.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("b2b.users.fields.password")}</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
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
                        <FormLabel>{t("b2b.users.fields.confirmPassword")}</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressCompany"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>{t("b2b.users.fields.addressCompany")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressStreet"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>{t("b2b.users.fields.addressStreet")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressZipCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("b2b.users.fields.addressZipCode")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressCity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("b2b.users.fields.addressCity")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressCountry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("b2b.users.fields.addressCountry")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="md:col-span-2 flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canManage || verifyLoading || createMutation.isPending}
                      onClick={form.handleSubmit(runLoginVerify)}
                    >
                      <ShieldCheck className="h-4 w-4 mr-2" />
                      {verifyLoading ? t("b2b.users.verify.running") : t("b2b.users.verify.button")}
                    </Button>
                    <Button type="submit" disabled={!canManage || createMutation.isPending}>
                      {createMutation.isPending
                        ? singleUpdateExisting
                          ? t("b2b.users.single.updating")
                          : t("b2b.users.single.creating")
                        : singleUpdateExisting
                          ? t("b2b.users.single.updateSubmit")
                          : t("b2b.users.single.submit")}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          {verifyResult ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {t("b2b.users.verify.resultTitle")}
                  <Badge variant={VERIFY_VARIANT[verifyResult.overall]}>
                    {verifyOverallLabel(verifyResult.overall)}
                  </Badge>
                </CardTitle>
                <CardDescription>{verifyResult.login.message}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("b2b.users.verify.table.check")}</TableHead>
                      <TableHead>{t("b2b.status")}</TableHead>
                      <TableHead>{t("b2b.users.import.table.message")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {verifyResult.checks.map((check) => (
                      <TableRow key={check.id}>
                        <TableCell>{check.label}</TableCell>
                        <TableCell>
                          <Badge variant={CHECK_STATUS_VARIANT[check.status]}>
                            {t(`b2b.users.verify.checkStatus.${check.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>{check.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="import" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>{t("b2b.users.import.title")}</CardTitle>
                <CardDescription>{t("b2b.users.import.description")}</CardDescription>
              </div>
              <Button variant="outline" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                {t("b2b.users.import.downloadTemplate")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const dropped = e.dataTransfer.files?.[0];
                  if (dropped) setImportFile(dropped);
                }}
                className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              >
                <FileUp className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium">{t("b2b.users.import.dropzone")}</p>
                <p className="text-sm text-muted-foreground">{t("b2b.users.import.dropzoneSub")}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {importFile ? (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4" />
                    <span>{importFile.name}</span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setImportFile(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">{t("b2b.users.fields.salesChannel")}</label>
                  <Select value={importSalesChannelId} onValueChange={setImportSalesChannelId}>
                    <SelectTrigger><SelectValue placeholder={t("b2b.users.fields.salesChannelPlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      {availableSalesChannels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>{channel.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
                  <div>
                    <p className="text-sm font-medium">{t("b2b.users.import.updateExisting")}</p>
                    <p className="text-xs text-muted-foreground">{t("b2b.users.import.updateExistingHint")}</p>
                  </div>
                  <Switch checked={importUpdateExisting} onCheckedChange={setImportUpdateExisting} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {importUpdateExisting
                      ? t("b2b.users.fields.passwordOptional")
                      : t("b2b.users.fields.password")}
                  </label>
                  <Input
                    type="password"
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder={importUpdateExisting ? t("b2b.users.fields.passwordOptionalPlaceholder") : undefined}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("b2b.users.fields.defaultType")}</label>
                  <Select value={importDefaultType} onValueChange={(value) => setImportDefaultType(value as PortalUserType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company">{typeLabel("company")}</SelectItem>
                      <SelectItem value="dealer">{typeLabel("dealer")}</SelectItem>
                      <SelectItem value="sales_rep">{typeLabel("sales_rep")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {importDefaultType === "sales_rep" ? (
                  <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
                    <span className="text-sm font-medium">{t("b2b.users.fields.defaultSupervisor")}</span>
                    <Switch checked={importDefaultSupervisor} onCheckedChange={setImportDefaultSupervisor} />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("b2b.users.fields.groupCompany")}</label>
                  <Select value={importGroupIdCompany} onValueChange={setImportGroupIdCompany}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("b2b.users.fields.groupDealer")}</label>
                  <Select value={importGroupIdDealer} onValueChange={setImportGroupIdDealer}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">{t("b2b.users.fields.groupSalesRep")}</label>
                  <Select value={importGroupIdSalesRep} onValueChange={setImportGroupIdSalesRep}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {importDefaultType === "sales_rep" ? (
                  <>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-medium">{t("b2b.users.fields.metaCompany")}</label>
                      <Select value={importMetaCompanyCustomerId} onValueChange={setImportMetaCompanyCustomerId}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {companies.map((company) => (
                            <SelectItem key={company.id} value={company.customerId || company.id}>
                              {company.company}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {importDefaultSupervisor ? (
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-sm font-medium">{t("b2b.users.fields.supervisorRole")}</label>
                        <Select value={importSupervisorRoleId} onValueChange={setImportSupervisorRoleId}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {roles.map((role) => (
                              <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">{t("b2b.users.fields.addressStreet")}</label>
                  <Input
                    value={importAddress.street}
                    onChange={(e) => setImportAddress((prev) => ({ ...prev, street: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("b2b.users.fields.addressZipCode")}</label>
                  <Input
                    value={importAddress.zipCode}
                    onChange={(e) => setImportAddress((prev) => ({ ...prev, zipCode: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("b2b.users.fields.addressCity")}</label>
                  <Input
                    value={importAddress.city}
                    onChange={(e) => setImportAddress((prev) => ({ ...prev, city: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!canManage || !importReady || importLoading !== null}
                  onClick={() => submitImport(false)}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  {importLoading === "dry-run" ? t("b2b.users.import.running") : t("b2b.users.import.dryRun")}
                </Button>
                <Button
                  disabled={!canManage || !importReady || importLoading !== null}
                  onClick={() => submitImport(true)}
                >
                  <Play className="h-4 w-4 mr-2" />
                  {importLoading === "apply" ? t("b2b.users.import.running") : t("b2b.users.import.apply")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {importResult ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {importResult.mode === "apply"
                    ? t("b2b.users.import.appliedTitle")
                    : t("b2b.users.import.dryRunTitle")}
                </CardTitle>
                <CardDescription>
                  {t("b2b.users.import.summary", {
                    total: importResult.totalRows,
                    created: importResult.created,
                    wouldCreate: importResult.wouldCreate,
                    updated: importResult.updated ?? 0,
                    wouldUpdate: importResult.wouldUpdate ?? 0,
                    skipped: importResult.skippedDuplicate,
                    errors: importResult.errors,
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {importResult.parseErrors && importResult.parseErrors.length > 0 ? (
                  <Alert variant="destructive">
                    <AlertTitle>{t("b2b.users.import.parseErrorsTitle")}</AlertTitle>
                    <AlertDescription>
                      {importResult.parseErrors.map((entry) => (
                        <div key={`${entry.rowNumber}-${entry.message}`}>
                          {t("b2b.users.import.parseErrorLine", {
                            row: entry.rowNumber,
                            message: entry.message,
                          })}
                        </div>
                      ))}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {problemRows.length > 0 ? (
                  <Alert>
                    <AlertTitle>{t("b2b.users.import.problemsTitle")}</AlertTitle>
                    <AlertDescription>{t("b2b.users.import.problemsHint")}</AlertDescription>
                  </Alert>
                ) : null}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("b2b.users.import.table.row")}</TableHead>
                      <TableHead>{t("b2b.users.fields.firstName")}</TableHead>
                      <TableHead>{t("b2b.users.fields.lastName")}</TableHead>
                      <TableHead>{t("b2b.email")}</TableHead>
                      <TableHead>{t("b2b.users.fields.type")}</TableHead>
                      <TableHead>{t("b2b.status")}</TableHead>
                      <TableHead>{t("b2b.users.verify.table.overall")}</TableHead>
                      <TableHead>{t("b2b.users.import.table.message")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importResult.rows.map((row) => (
                      <TableRow key={`${row.rowNumber}-${row.email}`}>
                        <TableCell>{row.rowNumber ?? "-"}</TableCell>
                        <TableCell>{row.firstName}</TableCell>
                        <TableCell>{row.lastName}</TableCell>
                        <TableCell>{row.email}</TableCell>
                        <TableCell>{typeLabel(row.type)}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[row.status]}>{statusLabel(row.status)}</Badge>
                        </TableCell>
                        <TableCell>
                          {row.verify ? (
                            <Badge variant={VERIFY_VARIANT[row.verify.overall]}>
                              {verifyOverallLabel(row.verify.overall)}
                            </Badge>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>{row.message || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
