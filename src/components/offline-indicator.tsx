import { Badge } from "@/components/ui/badge";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";

export function OfflineIndicator({
  online,
  pendingCount,
  syncing,
}: {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
}) {
  if (online && pendingCount === 0 && !syncing) return null;

  return (
    <div className="flex items-center gap-2">
      {syncing && (
        <Badge variant="secondary" className="gap-1">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Syncing
        </Badge>
      )}
      {!online && (
        <Badge variant="destructive" className="gap-1">
          <CloudOff className="h-3 w-3" />
          Offline
        </Badge>
      )}
      {pendingCount > 0 && (
        <Badge variant="outline" className="gap-1">
          <Wifi className="h-3 w-3" />
          {pendingCount} pending
        </Badge>
      )}
    </div>
  );
}
