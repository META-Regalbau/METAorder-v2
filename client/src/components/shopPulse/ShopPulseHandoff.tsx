import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, Copy, Forward, Loader2, Send, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ShopPulseOverview, ShopPulseSignal } from "@shared/shopPulse";
import { SHOP_PULSE_TICKET_PRIORITIES, type ShopPulseHandoff } from "@shared/shopPulseHandoff";

/**
 * Shop-Puls Stufe 3 (S3-1) an einer Meldung: „Für Agentur/Smarketer weitergeben“ (fertiger Text an Oliver
 * per Teams und zum Kopieren), Ticket anlegen, Stand der Weitergaben („weitergegeben am …“, erledigt).
 * Dazu die Karte der Jana-Liste. Server: server/routes/shopPulseHandoffRoutes.ts.
 */

const QUERY_KEY = ["/api/shop-pulse"];
const NONE = "__none__";

/** In 2 Werktagen (Mo–Fr), als Kalendertag YYYY-MM-DD in Ortszeit */
function dueIn(businessDays: number): string {
  const d = new Date();
  let left = businessDays;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SignalHandoffActions({ signal, title, message }: { signal: ShopPulseSignal; title: string; message: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [ticketOpen, setTicketOpen] = useState(false);
  const [shown, setShown] = useState<ShopPulseHandoff | null>(null);

  const forward = useMutation({
    mutationFn: async (kind: "agency" | "marketing") =>
      (await (await apiRequest("POST", `/api/shop-pulse/signals/${encodeURIComponent(signal.id)}/forward`, { kind })).json()) as { handoff: ShopPulseHandoff },
    onSuccess: ({ handoff }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setShown(handoff);
      toast({ title: t("shopPulse.handoff.forwarded") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.handoff.forwardFailed"), description: error.message, variant: "destructive" }),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={forward.isPending} data-testid={`button-shop-pulse-forward-${signal.id}`}>
            {forward.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Forward className="h-4 w-4 mr-1" aria-hidden="true" />}
            {t("shopPulse.handoff.forward")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => forward.mutate("agency")} data-testid={`menu-shop-pulse-forward-agency-${signal.id}`}>
            {t("shopPulse.handoff.forAgency")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => forward.mutate("marketing")} data-testid={`menu-shop-pulse-forward-marketing-${signal.id}`}>
            {t("shopPulse.handoff.forMarketing")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="ghost" onClick={() => setTicketOpen(true)} data-testid={`button-shop-pulse-ticket-${signal.id}`}>
        <Ticket className="h-4 w-4 mr-1" aria-hidden="true" />
        {t("shopPulse.handoff.ticket")}
      </Button>
      {ticketOpen ? <TicketDialog signal={signal} title={title} message={message} onClose={() => setTicketOpen(false)} /> : null}
      {shown ? <HandoffTextDialog handoff={shown} onClose={() => setShown(null)} /> : null}
    </>
  );
}

function HandoffTextDialog({ handoff, onClose }: { handoff: ShopPulseHandoff; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(handoff.text);
      toast({ title: t("shopPulse.handoff.copied") });
    } catch {
      toast({ title: t("shopPulse.handoff.copyFailed"), variant: "destructive" });
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("shopPulse.handoff.textTitle", { recipient: handoff.recipient })}</DialogTitle>
          <DialogDescription>{t("shopPulse.handoff.textHint")}</DialogDescription>
        </DialogHeader>
        <Textarea readOnly value={handoff.text} rows={16} lang="de" className="font-mono text-xs" aria-label={t("shopPulse.handoff.textLabel")} data-testid="textarea-shop-pulse-handoff-text" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("shopPulse.signals.cancel")}
          </Button>
          <Button onClick={copy} data-testid="button-shop-pulse-handoff-copy">
            <Copy className="h-4 w-4 mr-2" aria-hidden="true" />
            {t("shopPulse.handoff.copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TicketDialog({ signal, title, message, onClose }: { signal: ShopPulseSignal; title: string; message: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const users = useQuery<Array<{ id: string; username: string }>>({ queryKey: ["/api/users/assignable"] });
  const [form, setForm] = useState({ title: title.slice(0, 200), description: message, dueDate: dueIn(2), priority: "normal", assignee: NONE });
  const create = useMutation({
    mutationFn: async () =>
      (await (
        await apiRequest("POST", `/api/shop-pulse/signals/${encodeURIComponent(signal.id)}/ticket`, {
          title: form.title.trim(),
          description: form.description.trim(),
          dueDate: form.dueDate,
          priority: form.priority,
          assignedToUserId: form.assignee === NONE ? null : form.assignee,
        })
      ).json()) as { handoff: ShopPulseHandoff },
    onSuccess: ({ handoff }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: t("shopPulse.handoff.ticketCreated", { number: handoff.ticketNumber ?? "" }) });
      onClose();
    },
    onError: (error: Error) => toast({ title: t("shopPulse.handoff.ticketFailed"), description: error.message, variant: "destructive" }),
  });
  const valid = form.title.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(form.dueDate);
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("shopPulse.handoff.ticketTitle")}</DialogTitle>
          <DialogDescription>{t("shopPulse.handoff.ticketHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="shop-pulse-ticket-title">{t("shopPulse.handoff.fields.title")}</Label>
            <Input id="shop-pulse-ticket-title" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} required data-testid="input-shop-pulse-ticket-title" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shop-pulse-ticket-description">{t("shopPulse.handoff.fields.description")}</Label>
            <Textarea id="shop-pulse-ticket-description" value={form.description} rows={5} maxLength={8000} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="textarea-shop-pulse-ticket-description" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="shop-pulse-ticket-due">{t("shopPulse.handoff.fields.dueDate")}</Label>
              <Input id="shop-pulse-ticket-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required data-testid="input-shop-pulse-ticket-due" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shop-pulse-ticket-priority">{t("shopPulse.handoff.fields.priority")}</Label>
              <Select value={form.priority} onValueChange={(priority) => setForm({ ...form, priority })}>
                <SelectTrigger id="shop-pulse-ticket-priority" data-testid="select-shop-pulse-ticket-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHOP_PULSE_TICKET_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`shopPulse.handoff.priorities.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="shop-pulse-ticket-assignee">{t("shopPulse.handoff.fields.assignee")}</Label>
              <Select value={form.assignee} onValueChange={(assignee) => setForm({ ...form, assignee })}>
                <SelectTrigger id="shop-pulse-ticket-assignee" data-testid="select-shop-pulse-ticket-assignee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("shopPulse.handoff.noAssignee")}</SelectItem>
                  {(users.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("shopPulse.signals.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || create.isPending} data-testid="button-shop-pulse-ticket-create">
              {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ticket className="h-4 w-4 mr-2" aria-hidden="true" />}
              {t("shopPulse.handoff.ticketCreate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Stand der Weitergaben einer Meldung (unter dem Status) */
export function SignalHandoffStatus({ handoffs }: { handoffs: ShopPulseHandoff[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const [shown, setShown] = useState<ShopPulseHandoff | null>(null);
  const done = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/shop-pulse/handoffs/${encodeURIComponent(id)}/done`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: t("shopPulse.handoff.doneToast") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.signals.actionFailed"), description: error.message, variant: "destructive" }),
  });
  if (!handoffs.length) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs" data-testid="list-shop-pulse-handoffs">
      {handoffs.map((h) => (
        <li key={h.id} className={h.doneAt ? "text-muted-foreground" : ""} data-testid={`text-shop-pulse-handoff-${h.id}`}>
          {h.kind === "ticket" ? (
            <span>
              {t("shopPulse.handoff.ticketStatus", { at: fmt.dateTime(h.createdAt) })}{" "}
              <Link href={`/tickets?search=${encodeURIComponent(h.ticketNumber ?? "")}`} className="underline">
                {h.ticketNumber}
              </Link>
            </span>
          ) : (
            <span>{t("shopPulse.handoff.status", { at: fmt.dateTime(h.createdAt), recipient: h.recipient })}</span>
          )}
          {h.remindedAt && !h.doneAt ? <span> · {t("shopPulse.handoff.reminded", { at: fmt.dateTime(h.remindedAt) })}</span> : null}
          {h.doneAt ? <span> · {t("shopPulse.handoff.done", { at: fmt.dateTime(h.doneAt) })}</span> : null}
          <span className="ml-1 inline-flex gap-1">
            {h.kind !== "ticket" ? (
              <Button size="sm" variant="ghost" className="h-auto p-0 text-xs underline" onClick={() => setShown(h)} data-testid={`button-shop-pulse-handoff-text-${h.id}`}>
                {t("shopPulse.handoff.showText")}
              </Button>
            ) : null}
            {!h.doneAt ? (
              <Button size="sm" variant="ghost" className="h-auto p-0 text-xs underline" disabled={done.isPending} onClick={() => done.mutate(h.id)} data-testid={`button-shop-pulse-handoff-done-${h.id}`}>
                <CheckCircle2 className="h-3 w-3 mr-0.5" aria-hidden="true" />
                {t("shopPulse.handoff.markDone")}
              </Button>
            ) : null}
          </span>
        </li>
      ))}
      {shown ? <HandoffTextDialog handoff={shown} onClose={() => setShown(null)} /> : null}
    </ul>
  );
}

/** Jana-Liste: zuletzt gesendet, jetzt senden */
export function ShopPulseJanaList({ data }: { data: ShopPulseOverview }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const send = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/shop-pulse/jana-list/send"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: t("shopPulse.handoff.janaSent") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.handoff.janaFailed"), description: error.message, variant: "destructive" }),
  });
  return (
    <div className="border-t pt-3 space-y-2" data-testid="shop-pulse-jana">
      <h3 className="font-medium flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t("shopPulse.handoff.janaTitle")}
      </h3>
      <p className="text-sm" data-testid="text-shop-pulse-jana">
        {data.janaList
          ? t("shopPulse.handoff.janaLast", { at: fmt.dateTime(data.janaList.sentAt), total: fmt.integer(data.janaList.total), added: fmt.integer(data.janaList.added), fixed: fmt.integer(data.janaList.fixed) })
          : t("shopPulse.handoff.janaNever")}
      </p>
      <p className="text-xs text-muted-foreground max-w-3xl">{t("shopPulse.handoff.janaHint")}</p>
      <Button size="sm" variant="outline" disabled={!data.dataGaps || send.isPending} onClick={() => send.mutate()} data-testid="button-shop-pulse-jana-send">
        {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" aria-hidden="true" />}
        {t("shopPulse.handoff.janaSend")}
      </Button>
    </div>
  );
}
