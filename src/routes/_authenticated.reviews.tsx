import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, EyeOff, LoaderCircle, MessageSquareQuote, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  listAdminCustomerReviews,
  moderateCustomerReview,
  removeCustomerReview,
} from "@/lib/api/review.functions";

export const Route = createFileRoute("/_authenticated/reviews")({
  head: () => ({ meta: [{ title: "Customer Reviews — Coffee Zone" }] }),
  component: CustomerReviewsAdmin,
});

type AdminReview = Awaited<ReturnType<typeof listAdminCustomerReviews>>[number];

function CustomerReviewsAdmin() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listAdminCustomerReviews);
  const moderateFn = useServerFn(moderateCustomerReview);
  const removeFn = useServerFn(removeCustomerReview);
  const [reviewToDelete, setReviewToDelete] = useState<AdminReview | null>(null);
  const { data: reviews = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-customer-reviews"],
    queryFn: () => listFn(),
  });
  const refreshReviews = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-customer-reviews"] });
  const moderateMutation = useMutation({
    mutationFn: (review: AdminReview) =>
      moderateFn({
        data: {
          review_id: review.id,
          status: review.status === "published" ? "hidden" : "published",
        },
      }),
    onSuccess: async (_, review) => {
      toast.success(review.status === "published" ? "Review hidden." : "Review published.");
      await refreshReviews();
    },
    onError: (error) => toast.error(error.message || "Review visibility could not be updated."),
  });
  const deleteMutation = useMutation({
    mutationFn: (reviewId: string) => removeFn({ data: { review_id: reviewId } }),
    onSuccess: async () => {
      setReviewToDelete(null);
      toast.success("Review removed.");
      await refreshReviews();
    },
    onError: (error) => toast.error(error.message || "Review could not be removed."),
  });

  const pendingCount = reviews.filter((review) => review.status === "pending").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <MessageSquareQuote className="h-4 w-4" /> Customer feedback
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold">Customer Reviews</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approve reviews for public display, hide inappropriate content, or remove a review.
          </p>
        </div>
        <Badge variant={pendingCount ? "default" : "secondary"}>
          {pendingCount} awaiting approval
        </Badge>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading reviews...
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <p role="alert" className="text-sm text-destructive">
              Reviews could not be loaded. Verify Admin access and that the latest Supabase
              migrations have been applied, then try again.
            </p>
            <Button type="button" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : reviews.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No customer reviews have been submitted yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <Card key={review.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="space-y-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <span className="inline-flex items-center gap-1 text-amber-500">
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          className={`h-4 w-4 ${index < review.rating ? "fill-amber-400" : "text-muted-foreground/40"}`}
                          aria-hidden="true"
                        />
                      ))}
                    </span>
                    <span>{review.rating} out of 5</span>
                    <Badge
                      variant={
                        review.status === "published"
                          ? "secondary"
                          : review.status === "hidden" || review.status === "removed"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {review.status === "pending"
                        ? "Pending approval"
                        : review.status === "removed"
                          ? "Removed"
                          : review.status}
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Verified reservation {review.reservation_number} ·{" "}
                    {new Date(review.created_at).toLocaleString("en-PH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={moderateMutation.isPending || review.status === "removed"}
                    onClick={() => moderateMutation.mutate(review)}
                  >
                    {review.status === "removed" ? (
                      "Removed"
                    ) : review.status === "published" ? (
                      <>
                        <EyeOff className="h-4 w-4" /> Hide
                      </>
                    ) : (
                      <>
                        <Eye className="h-4 w-4" /> Publish
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deleteMutation.isPending || review.status === "removed"}
                    onClick={() => setReviewToDelete(review)}
                  >
                    {review.status === "removed" ? null : <Trash2 className="h-4 w-4" />}
                    {review.status === "removed" ? "Removed" : "Remove"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {review.comment ? (
                  <p className="whitespace-pre-wrap break-words text-sm">{review.comment}</p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">No written comment.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={reviewToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setReviewToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this customer review from public display?</AlertDialogTitle>
            <AlertDialogDescription>
              The review will no longer appear on the customer website. It remains in the private
              Admin record to prevent duplicate reviews for this completed reservation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (reviewToDelete) deleteMutation.mutate(reviewToDelete.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove review"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
