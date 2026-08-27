import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Role } from "@shared/schema";

export type B2BCompanyDetail = {
  offerCustomerId: string | null;
  customerId: string;
  company: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  customerNumber: string | null;
  active: boolean;
  accountType: string | null;
  vatIds: string[];
  phoneNumber: string | null;
  lastLogin: string | null;
  orderCount: number | null;
  orderTotalAmount: number | null;
  createdAt: string | null;
  customFields: Record<string, unknown> | null;
  customFieldMedia: Record<string, string>;
  billingAddress: {
    company: string | null;
    firstName: string | null;
    lastName: string | null;
    street: string;
    zipCode: string;
    city: string;
    country: string | null;
    phoneNumber: string | null;
  } | null;
  salesChannelName: string | null;
  customerGroupName: string | null;
  employees: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    department: string | null;
    phoneNumber: string | null;
    active: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    lastLogin: string | null;
  }[];
  employeeTotal: number;
  employeesError: boolean;
  budgets: {
    id: string;
    name: string;
    sum: number;
    periodType: string | null;
    active: boolean;
  }[];
  customerPrices: {
    count: number | null;
    hasAny: boolean;
    pluginDetected: boolean;
  };
  crmCustomerId: string | null;
  tags: string[];
};

type B2BCompanyDetailModalProps = {
  open: boolean;
  onClose: () => void;
  companyId: string | null;
  companyName?: string;
  userPermissions?: Role["permissions"];
};

const dateFormatter = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? "—"}</dd>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

type B2BEmployee = B2BCompanyDetail["employees"][number];

function EditEmployeeDialog({
  employee,
  companyId,
  onClose,
}: {
  employee: B2BEmployee | null;
  companyId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [department, setDepartment] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [active, setActive] = useState(true);
  const [password, setPassword] = useState("");

  // Formular bei jedem neu geöffneten Mitarbeiter mit dessen Daten befüllen.
  useEffect(() => {
    if (!employee) return;
    setFirstName(employee.firstName ?? "");
    setLastName(employee.lastName ?? "");
    setDepartment(employee.department ?? "");
    setPhoneNumber(employee.phoneNumber ?? "");
    setActive(employee.active);
    setPassword("");
  }, [employee]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!employee) throw new Error("Kein Mitarbeiter ausgewählt");
      const payload: Record<string, unknown> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        department: department.trim(),
        phoneNumber: phoneNumber.trim(),
        active,
      };
      if (password.trim()) {
        payload.password = password.trim();
      }
      const res = await apiRequest("PATCH", `/api/b2b/employees/${employee.id}`, payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json() as Promise<{ passwordChanged?: boolean }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/companies", companyId, "detail"] });
      toast({
        title: result?.passwordChanged
          ? t("b2b.accounts.detail.employeeUpdatedWithPassword")
          : t("b2b.accounts.detail.employeeUpdated"),
      });
      onClose();
    },
    onError: (e: Error) => {
      toast({
        title: t("b2b.accounts.detail.employeeUpdateFailed"),
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const passwordTooShort = password.trim().length > 0 && password.trim().length < 8;
  const canSubmit =
    Boolean(firstName.trim()) && Boolean(lastName.trim()) && !passwordTooShort && !mutation.isPending;

  return (
    <Dialog open={Boolean(employee)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("b2b.accounts.detail.editEmployeeTitle")}</DialogTitle>
          <DialogDescription>{t("b2b.accounts.detail.editEmployeeDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-emp-first">{t("b2b.accounts.detail.employeeFirstName")}</Label>
              <Input
                id="edit-emp-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                data-testid="input-employee-firstname"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-emp-last">{t("b2b.accounts.detail.employeeLastName")}</Label>
              <Input
                id="edit-emp-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                data-testid="input-employee-lastname"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("b2b.email")}</Label>
            <Input value={employee?.email ?? ""} disabled />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-emp-dep">{t("b2b.department")}</Label>
              <Input
                id="edit-emp-dep"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                data-testid="input-employee-department"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-emp-phone">{t("b2b.accounts.detail.employeePhone")}</Label>
              <Input
                id="edit-emp-phone"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                data-testid="input-employee-phone"
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="edit-emp-active" className="cursor-pointer">
              {t("b2b.status")}
            </Label>
            <Switch id="edit-emp-active" checked={active} onCheckedChange={setActive} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-emp-pw">{t("b2b.accounts.detail.employeeNewPassword")}</Label>
            <Input
              id="edit-emp-pw"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
              data-testid="input-employee-password"
            />
            <p className={`text-xs ${passwordTooShort ? "text-destructive" : "text-muted-foreground"}`}>
              {t("b2b.accounts.detail.employeeNewPasswordHint")}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="button-save-employee">
              {t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type B2BRole = { id: string; name: string; technicalName: string | null };

function NewEmployeeDialog({
  open,
  customerId,
  companyId,
  onClose,
}: {
  open: boolean;
  customerId: string | null;
  companyId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [roleId, setRoleId] = useState<string>("");
  const [password, setPassword] = useState("");

  // Formular bei jedem Öffnen zurücksetzen.
  useEffect(() => {
    if (!open) return;
    setFirstName("");
    setLastName("");
    setEmail("");
    setDepartment("");
    setPhoneNumber("");
    setRoleId("");
    setPassword("");
  }, [open]);

  const { data: rolesData } = useQuery<{ roles: B2BRole[] }>({
    queryKey: ["/api/b2b/roles"],
    queryFn: async () => {
      const res = await fetch("/api/b2b/roles", { credentials: "include" });
      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    },
    enabled: open,
  });
  const roles = rolesData?.roles ?? [];

  const mutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error("Kein Kunde ausgewählt");
      const res = await apiRequest("POST", `/api/b2b/companies/${customerId}/employees`, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        department: department.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        roleId: roleId || undefined,
        password: password.trim(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/companies", companyId, "detail"] });
      toast({ title: t("b2b.accounts.detail.employeeCreated") });
      onClose();
    },
    onError: (e: Error) => {
      toast({
        title: t("b2b.accounts.detail.employeeCreateFailed"),
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const emailValid = /.+@.+\..+/.test(email.trim());
  const passwordTooShort = password.trim().length > 0 && password.trim().length < 8;
  const canSubmit =
    Boolean(firstName.trim()) &&
    Boolean(lastName.trim()) &&
    emailValid &&
    password.trim().length >= 8 &&
    !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("b2b.accounts.detail.newEmployeeTitle")}</DialogTitle>
          <DialogDescription>{t("b2b.accounts.detail.newEmployeeDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="new-emp-first">{t("b2b.accounts.detail.employeeFirstName")}</Label>
              <Input
                id="new-emp-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                data-testid="input-new-employee-firstname"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-emp-last">{t("b2b.accounts.detail.employeeLastName")}</Label>
              <Input
                id="new-emp-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                data-testid="input-new-employee-lastname"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-emp-email">{t("b2b.email")}</Label>
            <Input
              id="new-emp-email"
              type="email"
              value={email}
              autoComplete="off"
              onChange={(e) => setEmail(e.target.value)}
              data-testid="input-new-employee-email"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="new-emp-dep">{t("b2b.department")}</Label>
              <Input
                id="new-emp-dep"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                data-testid="input-new-employee-department"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-emp-phone">{t("b2b.accounts.detail.employeePhone")}</Label>
              <Input
                id="new-emp-phone"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                data-testid="input-new-employee-phone"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("b2b.accounts.detail.employeeRole")}</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger data-testid="select-new-employee-role">
                <SelectValue placeholder={t("b2b.accounts.detail.employeeRoleDefault")} />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-emp-pw">{t("b2b.accounts.detail.employeePassword")}</Label>
            <Input
              id="new-emp-pw"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
              data-testid="input-new-employee-password"
            />
            <p className={`text-xs ${passwordTooShort ? "text-destructive" : "text-muted-foreground"}`}>
              {t("b2b.accounts.detail.employeePasswordHint")}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="button-create-employee">
              {t("common.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function B2BCompanyDetailModal({
  open,
  onClose,
  companyId,
  companyName,
  userPermissions,
}: B2BCompanyDetailModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = userPermissions?.manageB2B;
  const [employeeToDelete, setEmployeeToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [employeeToEdit, setEmployeeToEdit] = useState<B2BEmployee | null>(null);
  const [newEmployeeOpen, setNewEmployeeOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery<B2BCompanyDetail>({
    queryKey: ["/api/b2b/companies", companyId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/b2b/companies/${companyId}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json();
    },
    enabled: open && Boolean(companyId),
  });

  const employeeActionMutation = useMutation({
    mutationFn: async ({
      employeeId,
      action,
    }: {
      employeeId: string;
      action: "activate" | "deactivate" | "delete";
    }) => {
      const res =
        action === "delete"
          ? await apiRequest("DELETE", `/api/b2b/employees/${employeeId}`)
          : await apiRequest("POST", `/api/b2b/employees/${employeeId}/${action}`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/companies", companyId, "detail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/companies"] });
      const title =
        variables.action === "activate"
          ? t("b2b.accounts.detail.employeeActivated")
          : variables.action === "deactivate"
            ? t("b2b.accounts.detail.employeeDeactivated")
            : t("b2b.accounts.detail.employeeDeleted");
      toast({ title });
      if (variables.action === "delete") {
        setEmployeeToDelete(null);
      }
    },
    onError: (e: Error) => {
      toast({
        title: t("b2b.accounts.detail.employeeActionFailed"),
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const contactName = [data?.firstName, data?.lastName].filter(Boolean).join(" ").trim();
  const customFieldEntries = data?.customFields
    ? Object.entries(data.customFields).filter(([, v]) => v !== null && v !== undefined && v !== "")
    : [];

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.company || companyName || t("b2b.accounts.detail.title")}</DialogTitle>
          <DialogDescription>{t("b2b.accounts.detail.subtitle")}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {isError ? (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : t("b2b.loadError")}
          </p>
        ) : null}

        {data ? (
          <div className="space-y-6">
            <section className="flex flex-wrap items-center gap-2">
              <Badge variant={data.active ? "default" : "secondary"}>
                {data.active ? t("b2b.active") : t("b2b.inactive")}
              </Badge>
              {data.accountType ? (
                <Badge variant="outline">{data.accountType}</Badge>
              ) : null}
              {data.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold">{t("b2b.accounts.detail.masterData")}</h3>
              <dl className="grid gap-4 sm:grid-cols-2">
                <DetailField label={t("b2b.company")} value={data.company} />
                <DetailField label={t("b2b.customerNumber")} value={data.customerNumber} />
                <DetailField label={t("b2b.email")} value={data.email} />
                <DetailField label={t("b2b.accounts.detail.contactPerson")} value={contactName || "—"} />
                <DetailField label={t("b2b.accounts.detail.phone")} value={data.phoneNumber} />
                <DetailField label={t("b2b.accounts.detail.customerGroup")} value={data.customerGroupName} />
                <DetailField label={t("b2b.accounts.detail.salesChannel")} value={data.salesChannelName} />
                <DetailField
                  label={t("b2b.accounts.detail.vatIds")}
                  value={data.vatIds.length ? data.vatIds.join(", ") : "—"}
                />
                <DetailField label={t("b2b.accounts.detail.createdAt")} value={formatDate(data.createdAt)} />
                <DetailField label={t("b2b.accounts.detail.lastLogin")} value={formatDate(data.lastLogin)} />
                <DetailField label={t("b2b.accounts.detail.orderCount")} value={data.orderCount ?? "—"} />
                <DetailField
                  label={t("b2b.accounts.detail.orderTotal")}
                  value={data.orderTotalAmount != null ? currencyFormatter.format(data.orderTotalAmount) : "—"}
                />
                <DetailField label={t("b2b.accounts.detail.customerId")} value={data.customerId} />
                {data.offerCustomerId ? (
                  <DetailField label={t("b2b.accounts.detail.offerCustomerId")} value={data.offerCustomerId} />
                ) : null}
              </dl>
            </section>

            {data.billingAddress ? (
              <section>
                <h3 className="mb-3 text-sm font-semibold">{t("b2b.accounts.detail.billingAddress")}</h3>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <DetailField label={t("b2b.company")} value={data.billingAddress.company} />
                  <DetailField
                    label={t("b2b.name")}
                    value={[data.billingAddress.firstName, data.billingAddress.lastName].filter(Boolean).join(" ") || "—"}
                  />
                  <DetailField label={t("b2b.accounts.detail.street")} value={data.billingAddress.street} />
                  <DetailField
                    label={t("b2b.accounts.detail.city")}
                    value={[data.billingAddress.zipCode, data.billingAddress.city].filter(Boolean).join(" ") || "—"}
                  />
                  <DetailField label={t("b2b.accounts.detail.country")} value={data.billingAddress.country} />
                  <DetailField label={t("b2b.accounts.detail.phone")} value={data.billingAddress.phoneNumber} />
                </dl>
              </section>
            ) : null}

            {customFieldEntries.length > 0 ? (
              <section>
                <h3 className="mb-3 text-sm font-semibold">{t("b2b.accounts.detail.customFields")}</h3>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {customFieldEntries.map(([key, value]) => {
                    const label = t(`b2b.accounts.detail.customFieldLabels.${key}`, {
                      defaultValue: key.replace(/^b2b_/, "").replace(/_/g, " "),
                    });
                    const mediaUrl = data.customFieldMedia?.[key];
                    if (mediaUrl) {
                      return (
                        <DetailField
                          key={key}
                          label={label}
                          value={
                            <a href={mediaUrl} target="_blank" rel="noreferrer">
                              <img
                                src={mediaUrl}
                                alt={label}
                                className="h-14 w-auto max-w-[180px] rounded border bg-white object-contain p-1"
                                loading="lazy"
                              />
                            </a>
                          }
                        />
                      );
                    }
                    return (
                      <DetailField
                        key={key}
                        label={label}
                        value={
                          typeof value === "boolean"
                            ? value
                              ? t("b2b.active")
                              : t("b2b.inactive")
                            : String(value)
                        }
                      />
                    );
                  })}
                </dl>
              </section>
            ) : null}

            <Separator />

            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {t("b2b.accounts.employees")} ({data.employeeTotal ?? data.employees.length})
                </h3>
                {canManage && data.customerId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setNewEmployeeOpen(true)}
                    data-testid="button-new-employee"
                  >
                    {t("b2b.accounts.detail.newEmployee")}
                  </Button>
                ) : null}
              </div>
              {data.employeesError ? (
                <p className="mb-3 text-sm text-destructive">
                  {t("b2b.accounts.detail.employeesLoadError")}
                </p>
              ) : null}
              {!data.employeesError && data.employeeTotal > data.employees.length ? (
                <p className="mb-3 text-sm text-muted-foreground">
                  {t("b2b.accounts.detail.employeesTruncated", {
                    shown: data.employees.length,
                    total: data.employeeTotal,
                  })}
                </p>
              ) : null}
              {data.employees.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("b2b.name")}</TableHead>
                      <TableHead>{t("b2b.email")}</TableHead>
                      <TableHead>{t("b2b.department")}</TableHead>
                      <TableHead>{t("b2b.accounts.detail.employeeLastLogin")}</TableHead>
                      <TableHead>{t("b2b.status")}</TableHead>
                      {canManage ? (
                        <TableHead className="text-right">{t("b2b.accounts.detail.employeeActions")}</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.employees.map((employee) => (
                      <TableRow key={employee.id}>
                        <TableCell>{`${employee.firstName} ${employee.lastName}`.trim()}</TableCell>
                        <TableCell>{employee.email}</TableCell>
                        <TableCell>{employee.department || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDate(employee.lastLogin)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={employee.active ? "default" : "secondary"}>
                            {employee.active ? t("b2b.active") : t("b2b.inactive")}
                          </Badge>
                        </TableCell>
                        {canManage ? (
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEmployeeToEdit(employee)}
                                data-testid={`button-edit-employee-${employee.id}`}
                              >
                                {t("b2b.accounts.detail.editEmployee")}
                              </Button>
                              {employee.active ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={employeeActionMutation.isPending}
                                  onClick={() =>
                                    employeeActionMutation.mutate({
                                      employeeId: employee.id,
                                      action: "deactivate",
                                    })
                                  }
                                >
                                  {t("b2b.accounts.detail.deactivateEmployee")}
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={employeeActionMutation.isPending}
                                  onClick={() =>
                                    employeeActionMutation.mutate({
                                      employeeId: employee.id,
                                      action: "activate",
                                    })
                                  }
                                >
                                  {t("b2b.accounts.detail.activateEmployee")}
                                </Button>
                              )}
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={employeeActionMutation.isPending}
                                onClick={() =>
                                  setEmployeeToDelete({
                                    id: employee.id,
                                    name: `${employee.firstName} ${employee.lastName}`.trim() || employee.email,
                                  })
                                }
                              >
                                {t("b2b.accounts.detail.deleteEmployee")}
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">{t("b2b.noResults")}</p>
              )}
            </section>

            {data.budgets.length > 0 ? (
              <section>
                <h3 className="mb-3 text-sm font-semibold">
                  {t("b2b.budgets.list")} ({data.budgets.length})
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("b2b.budgets.name")}</TableHead>
                      <TableHead>{t("b2b.budgets.amount")}</TableHead>
                      <TableHead>{t("b2b.budgets.period")}</TableHead>
                      <TableHead>{t("b2b.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.budgets.map((budget) => (
                      <TableRow key={budget.id}>
                        <TableCell>{budget.name}</TableCell>
                        <TableCell>{currencyFormatter.format(budget.sum)}</TableCell>
                        <TableCell>{budget.periodType || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={budget.active ? "default" : "secondary"}>
                            {budget.active ? t("b2b.active") : t("b2b.inactive")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            ) : null}

            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {t("b2b.accounts.detail.customerPrices")}
                  {data.customerPrices?.count != null ? ` (${data.customerPrices.count})` : ""}
                </h3>
                {data.customerId ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/b2b/assortments?customerId=${encodeURIComponent(data.customerId)}`}>
                      {t("b2b.accounts.detail.openAssortments")}
                    </Link>
                  </Button>
                ) : null}
              </div>
              {!data.customerPrices?.pluginDetected ? (
                <p className="text-sm text-muted-foreground">{t("b2b.accounts.detail.pricesPluginMissing")}</p>
              ) : data.customerPrices.count != null ? (
                <p className="text-sm text-muted-foreground">
                  {data.customerPrices.count > 0
                    ? t("crm.customer.individualPrices.summary", { count: data.customerPrices.count })
                    : t("crm.customer.individualPrices.empty")}
                </p>
              ) : data.customerPrices.hasAny ? (
                <p className="text-sm text-muted-foreground">
                  {t("b2b.accounts.detail.pricesPresent")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("crm.customer.individualPrices.empty")}</p>
              )}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>

    <AlertDialog open={Boolean(employeeToDelete)} onOpenChange={(next) => !next && setEmployeeToDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("b2b.accounts.detail.deleteEmployeeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("b2b.accounts.detail.deleteEmployeeDescription")}
            {employeeToDelete ? ` (${employeeToDelete.name})` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={employeeActionMutation.isPending}
            onClick={() => {
              if (employeeToDelete) {
                employeeActionMutation.mutate({ employeeId: employeeToDelete.id, action: "delete" });
              }
            }}
          >
            {t("b2b.accounts.detail.deleteEmployee")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <EditEmployeeDialog
      employee={employeeToEdit}
      companyId={companyId}
      onClose={() => setEmployeeToEdit(null)}
    />

    <NewEmployeeDialog
      open={newEmployeeOpen}
      customerId={data?.customerId ?? null}
      companyId={companyId}
      onClose={() => setNewEmployeeOpen(false)}
    />
  </>
  );
}
