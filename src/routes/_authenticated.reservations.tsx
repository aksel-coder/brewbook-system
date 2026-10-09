import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { CalendarClock, ClipboardList, Eye, LoaderCircle, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTablePagination } from "@/components/data-table-pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import {
  completeCustomerReservation,
  createCustomerPhotoReadUrl,
  getCustomerReservation,
  listCustomerReservations,
} from "@/lib/api/reservation.functions";
import { getMyRole } from "@/lib/api/users.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reservations")({
  head: () => ({ meta: [{ title: "Reservations — Coffee Zone" }] }),
  component: Reservations,
});

type ReservationSummary = Awaited<ReturnType<typeof listCustomerReservations>>[number];
type ReservationDetails = Awaited<ReturnType<typeof getCustomerReservation>>;

const peso = (value: number) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function formatPickupTime(value: string) {
  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  if (!Number.isInteger(hours) || !minutesText) return value;
  return `${hours % 12 || 12}:${minutesText.slice(0, 2)} ${hours >= 12 ? "PM" : "AM"}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function normalizeReservationStatus(status: string | null | undefined) {
  const normalized = status?.trim().toLocaleUpperCase();
  return normalized === "PENDING" || normalized === "COMPLETED" ? normalized : null;
}

function displayReservationStatus(status: string | null | undefined) {
  const normalized = normalizeReservationStatus(status);
  if (normalized === "PENDING") return "Pending";
  if (normalized === "COMPLETED") return "Completed";
  return status?.trim() || "Unknown";
}

function Reservations() {
  const queryClient = useQueryClient();
  const roleFn = useServerFn(getMyRole);
  const listFn = useServerFn(listCustomerReservations);
  const detailFn = useServerFn(getCustomerReservation);
  const photoFn = useServerFn(createCustomerPhotoReadUrl);
  const completeFn = useServerFn(completeCustomerReservation);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingCompletion, setPendingCompletion] = useState<{
    reservationId: string;
    reservationNumber: string;
  } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const {
    data: me,
    isLoading: roleLoading,
    error: roleError,
  } = useQuery({ queryKey: ["me"], queryFn: () => roleFn() });

  const {
    data: reservations = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["customer-reservations"],
    queryFn: () => listFn(),
    enabled: me?.isAdmin === true,
    refetchOnWindowFocus: true,
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return reservations.filter((reservation) => {
      const matchesSearch =
        !query ||
        reservation.reservation_number.toLocaleLowerCase().includes(query) ||
        reservation.customer_name.toLocaleLowerCase().includes(query) ||
        reservation.contact_number.toLocaleLowerCase().includes(query);
      return matchesSearch;
    });
  }, [reservations, search]);
  const { paginatedItems, ...pagination } = usePagination(filtered);

  const {
    data: details,
    isLoading: detailsLoading,
    error: detailsError,
  } = useQuery({
    queryKey: ["customer-reservation", selectedId],
    queryFn: () => detailFn({ data: { reservation_id: selectedId! } }),
    enabled: selectedId !== null && me?.isAdmin === true,
    refetchOnMount: "always",
  });

  const {
    data: photo,
    isLoading: photoLoading,
    error: photoError,
  } = useQuery({
    queryKey: ["customer-reservation-photo", selectedId],
    queryFn: () => photoFn({ data: { reservation_id: selectedId! } }),
    enabled: selectedId !== null && me?.isAdmin === true,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const closeDetails = (open: boolean) => {
    if (!open) {
      setSelectedId(null);
      queryClient.removeQueries({ queryKey: ["customer-reservation-photo", selectedId] });
    }
  };

  const requestCompletion = (reservationId: string, reservationNumber: string) => {
    setPendingCompletion({ reservationId, reservationNumber });
  };

  const completeReservation = async (reservationId: string) => {
    setIsUpdating(true);
    try {
      const result = await completeFn({ data: { reservation_id: reservationId } });
      toast.success(`${result.reservation_number} completed successfully.`);
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: ["customer-reservations"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-reservation", reservationId] }),
      ];
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["sales"] }),
        queryClient.invalidateQueries({ queryKey: ["inventoryTxns"] }),
        queryClient.invalidateQueries({ queryKey: ["inventoryItems"] }),
        queryClient.invalidateQueries({ queryKey: ["inventoryMovements"] }),
      );
      await Promise.all(invalidations);
      setPendingCompletion(null);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "The reservation could not be completed.",
      );
    } finally {
      setIsUpdating(false);
    }
  };

  if (roleLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-muted-foreground">Checking reservation access…</CardContent>
      </Card>
    );
  }

  if (roleError) {
    return (
      <Card>
        <CardContent className="p-6 text-destructive">
          Reservation access could not be verified.
        </CardContent>
      </Card>
    );
  }

  if (!me?.isAdmin) {
    return (
      <Card>
        <CardContent className="p-6">
          <h1 className="font-display text-2xl font-bold">Access denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Only administrators can manage reservations.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <h1 className="font-display text-2xl font-bold">Reservations unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Reservations could not be loaded. Please try again later.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold">Reservations</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review customer pickup requests and record sales when they are fulfilled.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search reservations"
                className="pl-9 sm:w-64"
                placeholder="Search name, number, contact"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display">
              <ClipboardList className="h-5 w-5 text-primary" />
              Recent reservations
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reservation</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Pickup</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-28 text-center text-muted-foreground">
                      <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" /> Loading
                      reservations…
                    </TableCell>
                  </TableRow>
                ) : paginatedItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-28 text-center text-muted-foreground">
                      No reservations match your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedItems.map((reservation: ReservationSummary) => (
                    <TableRow key={reservation.id}>
                      <TableCell className="font-medium">
                        {reservation.reservation_number}
                      </TableCell>
                      <TableCell>{reservation.customer_name}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {reservation.contact_number}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {new Date(`${reservation.pickup_date}T00:00:00`).toLocaleDateString(
                          "en-PH",
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {formatPickupTime(reservation.pickup_time)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {peso(reservation.total_amount)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            normalizeReservationStatus(reservation.status) === "COMPLETED"
                              ? "secondary"
                              : normalizeReservationStatus(reservation.status) === "PENDING"
                                ? "outline"
                                : "destructive"
                          }
                        >
                          {displayReservationStatus(reservation.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(reservation.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedId(reservation.id)}
                        >
                          <Eye className="mr-1 h-4 w-4" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <div className="px-4">
              <DataTablePagination {...pagination} onPageChange={pagination.setPage} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={selectedId !== null} onOpenChange={closeDetails}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display">
              {details?.reservation_number ?? "Reservation details"}
            </DialogTitle>
            <DialogDescription>Customer, pickup, and requested item details.</DialogDescription>
          </DialogHeader>

          {detailsLoading ? (
            <div className="py-12 text-center text-muted-foreground">
              <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" /> Loading reservation…
            </div>
          ) : detailsError ? (
            <p className="py-6 text-sm text-destructive">
              Reservation details could not be loaded.
            </p>
          ) : details ? (
            <ReservationDetailContent
              details={details}
              photoUrl={photo?.signed_url}
              photoLoading={photoLoading}
              photoError={photoError}
              isUpdating={isUpdating}
              onComplete={() => requestCompletion(details.id, details.reservation_number)}
              hasSale={Boolean(details.sale)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingCompletion !== null}
        onOpenChange={(open) => !open && setPendingCompletion(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a sale for this reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCompletion?.reservationNumber} will be recorded as one sale and deducted from
              current stock exactly once. Reservations without an existing sale remain eligible for
              sale creation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdating}>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={isUpdating || !pendingCompletion}
              onClick={(event) => {
                event.preventDefault();
                if (pendingCompletion) void completeReservation(pendingCompletion.reservationId);
              }}
            >
              {isUpdating ? "Processing…" : "Create sale"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ReservationDetailContent({
  details,
  photoUrl,
  photoLoading,
  photoError,
  isUpdating,
  onComplete,
  hasSale,
}: {
  details: ReservationDetails;
  photoUrl?: string;
  photoLoading: boolean;
  photoError: Error | null;
  isUpdating: boolean;
  onComplete: () => void;
  hasSale: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Customer</Label>
            <p className="mt-1 flex items-center gap-2 font-medium">
              <UserRound className="h-4 w-4 text-muted-foreground" /> {details.customer_name}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Contact number</Label>
            <p className="mt-1 font-medium">{details.contact_number}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Pickup schedule</Label>
            <p className="mt-1 flex items-center gap-2 font-medium">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              {new Date(`${details.pickup_date}T00:00:00`).toLocaleDateString("en-PH")} at{" "}
              {formatPickupTime(details.pickup_time)}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Created</Label>
            <p className="mt-1 font-medium">{formatDateTime(details.created_at)}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Status</Label>
            <p className="mt-1">
              <Badge
                variant={
                  normalizeReservationStatus(details.status) === "COMPLETED"
                    ? "secondary"
                    : normalizeReservationStatus(details.status) === "PENDING"
                      ? "outline"
                      : "destructive"
                }
              >
                {displayReservationStatus(details.status)}
              </Badge>
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Total amount</Label>
            <p className="mt-1 text-lg font-semibold">{peso(details.total_amount)}</p>
          </div>
          {details.notes && (
            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Customer notes</Label>
              <p className="mt-1 whitespace-pre-wrap text-sm">{details.notes}</p>
            </div>
          )}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Customer photo</Label>
          {photoLoading ? (
            <div className="mt-2 flex aspect-square items-center justify-center rounded-lg border bg-muted text-muted-foreground">
              <LoaderCircle className="h-5 w-5 animate-spin" />
            </div>
          ) : photoError || !photoUrl ? (
            <div className="mt-2 flex aspect-square items-center justify-center rounded-lg border bg-muted p-3 text-center text-xs text-muted-foreground">
              Photo could not be loaded.
            </div>
          ) : (
            <img
              className="mt-2 aspect-square w-full rounded-lg border object-cover"
              src={photoUrl}
              alt={`Customer photo for ${details.reservation_number}`}
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Reserved items</h3>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Size / Variant</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {details.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.product_name}</TableCell>
                  <TableCell>{item.variant_name ?? "—"}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{peso(item.unit_price)}</TableCell>
                  <TableCell className="text-right">{peso(item.subtotal)}</TableCell>
                </TableRow>
              ))}
              {details.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No items found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Creating a sale deducts current stock atomically.
        </p>
        {!hasSale && normalizeReservationStatus(details.status) === "PENDING" && (
          <Button onClick={onComplete} disabled={isUpdating}>
            {isUpdating ? "Processing…" : "Create Sale"}
          </Button>
        )}
      </div>
    </div>
  );
}
