import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Copy } from "lucide-react";

export type ClarificationDraftKind = "offer" | "order";

interface CustomerClarificationEmailModalProps {
  kind: ClarificationDraftKind;
  draftId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CustomerClarificationEmailModal({
  kind,
  draftId,
  open,
  onOpenChange,
}: CustomerClarificationEmailModalProps) {
  const { toast } = useToast();
  const basePath = kind === "offer" ? "/api/offer-drafts" : "/api/order-drafts";

  const { data, isLoading, error } = useQuery<{ to: string; subject: string; body: string }>({
    queryKey: [basePath, draftId, "clarification-email"],
    queryFn: async () => {
      const res = await fetch(`${basePath}/${draftId}/clarification-email`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || res.statusText);
      }
      return res.json();
    },
    enabled: open && !!draftId,
  });

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (data) {
      setTo(data.to);
      setSubject(data.subject);
      setBody(data.body);
    }
  }, [data]);

  const handleCopy = async () => {
    const text = `An: ${to}\nBetreff: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Kopiert", description: "E-Mail-Entwurf wurde in die Zwischenablage kopiert." });
    } catch {
      toast({
        title: "Kopieren fehlgeschlagen",
        description: "Bitte markieren und manuell kopieren.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-clarification-email">
        <DialogHeader>
          <DialogTitle>Rückfrage an den Kunden</DialogTitle>
          <DialogDescription>
            Vorschau der Nachricht (kein Versand). Text anpassen und in Ihr Mail-Programm einfügen.
          </DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Wird geladen…</p>}
        {error && (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        )}
        {!isLoading && !error && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="clar-to">Empfänger</Label>
              <Input
                id="clar-to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="kunde@firma.de"
                data-testid="input-clarification-to"
              />
            </div>
            <div>
              <Label htmlFor="clar-subject">Betreff</Label>
              <Input
                id="clar-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                data-testid="input-clarification-subject"
              />
            </div>
            <div>
              <Label htmlFor="clar-body">Nachricht</Label>
              <Textarea
                id="clar-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="font-mono text-sm"
                data-testid="textarea-clarification-body"
              />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
          <Button type="button" onClick={handleCopy} disabled={isLoading || !!error}>
            <Copy className="w-4 h-4 mr-2" />
            In Zwischenablage kopieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
