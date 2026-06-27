import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import TableSkeleton from "@/components/TableSkeleton";
import {
  getGlobalLoadingCount,
  subscribeGlobalLoading,
} from "@/lib/globalLoading";

const SHOW_DELAY_MS = 150;
const MIN_VISIBLE_MS = 350;

type SkeletonVariant = "dashboard" | "orders" | "default";

interface GlobalSkeletonOverlayProps {
  variant: SkeletonVariant;
}

function GlobalSkeletonOverlay({ variant }: GlobalSkeletonOverlayProps) {
  const activeCount = useSyncExternalStore(
    subscribeGlobalLoading,
    getGlobalLoadingCount,
    getGlobalLoadingCount,
  );
  const [visible, setVisible] = useState(false);
  const isVisibleRef = useRef(false);
  const visibleSinceRef = useRef<number | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const show = () => {
    isVisibleRef.current = true;
    visibleSinceRef.current = Date.now();
    setVisible(true);
  };

  const hide = () => {
    isVisibleRef.current = false;
    visibleSinceRef.current = null;
    setVisible(false);
  };

  useEffect(() => {
    clearTimers();

    if (activeCount > 0) {
      if (!isVisibleRef.current) {
        showTimerRef.current = window.setTimeout(show, SHOW_DELAY_MS);
      }
      return clearTimers;
    }

    if (isVisibleRef.current) {
      const elapsed = Date.now() - (visibleSinceRef.current ?? 0);
      const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
      hideTimerRef.current = window.setTimeout(hide, remaining);
    }

    return clearTimers;
  }, [activeCount]);

  if (!visible) {
    return null;
  }

  const renderContent = () => {
    if (variant === "orders") {
      return (
        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-24" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <TableSkeleton columns={7} rows={8} />
          </div>
          {/* Kein Paginierungs-Skeleton: sonst wirkt es bei halbtransparentem Overlay wie doppelte Seitenleiste */}
        </div>
      );
    }

    if (variant === "dashboard") {
      return (
        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`kpi-${index}`} className="h-28 w-full" />
            ))}
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-6">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={`dash-left-${index}`} className="h-40 w-full" />
              ))}
            </div>
            <div className="space-y-6">
              {Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={`dash-right-${index}`} className="h-40 w-full" />
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-5/6" />
        </div>
      </div>
    );
  };

  return (
    <div
      className="absolute inset-0 z-10 pointer-events-none"
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />
      <div className="relative h-full w-full p-6">
        {renderContent()}
      </div>
    </div>
  );
}

export default GlobalSkeletonOverlay;
