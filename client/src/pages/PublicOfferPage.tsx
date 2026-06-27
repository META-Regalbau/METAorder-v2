import { useCallback, useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import OfferLandingView, { type OfferLandingData } from "@/components/offers/OfferLandingView";

type PublicOfferApiResponse = {
  offer: OfferLandingData;
  shareExpiresAt: string;
};

export default function PublicOfferPage() {
  const [, params] = useRoute("/angebot/:token");
  const token = params?.token ? decodeURIComponent(params.token) : "";
  const [banner, setBanner] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-offer", token],
    queryFn: async (): Promise<PublicOfferApiResponse> => {
      const res = await fetch(`/api/public/offers/${encodeURIComponent(token)}`, { credentials: "omit" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Laden fehlgeschlagen");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const acceptMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/offers/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Annahme fehlgeschlagen");
      return body as { success?: boolean; alreadyAccepted?: boolean };
    },
    onSuccess: (body) => {
      void queryClient.invalidateQueries({ queryKey: ["public-offer", token] });
      if (body.alreadyAccepted) {
        setBanner({ type: "info", message: "Dieses Angebot wurde bereits angenommen." });
      } else {
        setBanner({ type: "success", message: "Vielen Dank! Das Angebot wurde angenommen." });
      }
    },
    onError: (e: Error) => {
      setBanner({ type: "error", message: e.message });
    },
  });

  const declineMut = useMutation({
    mutationFn: async (reason?: string) => {
      const res = await fetch(`/api/public/offers/${encodeURIComponent(token)}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Ablehnung fehlgeschlagen");
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["public-offer", token] });
      setBanner({ type: "info", message: "Das Angebot wurde abgelehnt." });
    },
    onError: (e: Error) => {
      setBanner({ type: "error", message: e.message });
    },
  });

  const onAccept = useCallback(() => {
    setBanner(null);
    acceptMut.mutate();
  }, [acceptMut]);

  const onDecline = useCallback(
    (reason?: string) => {
      setBanner(null);
      declineMut.mutate(reason);
    },
    [declineMut],
  );

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <p className="text-muted-foreground">Ungültiger Link.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <p className="text-muted-foreground">Angebot wird geladen…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <p className="text-destructive text-center max-w-md">
          {(error as Error)?.message || "Angebot konnte nicht geladen werden."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
      <OfferLandingView
        offer={data.offer}
        shareExpiresAt={data.shareExpiresAt}
        publicToken={token}
        showCustomerActions
        banner={banner}
        onAccept={onAccept}
        onDecline={onDecline}
        acceptLoading={acceptMut.isPending}
        declineLoading={declineMut.isPending}
      />
    </div>
  );
}
