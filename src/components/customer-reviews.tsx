import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Star } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  listPublicCustomerReviews,
  submitCustomerReview,
} from "@/lib/api/review.functions";

function ReviewStars({ rating, size = "h-4 w-4" }: { rating: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={`${size} ${index < rating ? "fill-amber-400 text-amber-500" : "text-muted-foreground/40"}`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

export function CustomerReviews() {
  const queryClient = useQueryClient();
  const listReviewsFn = useServerFn(listPublicCustomerReviews);
  const submitReviewFn = useServerFn(submitCustomerReview);
  const [reservationNumber, setReservationNumber] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [contactNumberTouched, setContactNumberTouched] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [website, setWebsite] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const {
    data: reviews = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["public-customer-reviews"],
    queryFn: () => listReviewsFn(),
  });
  const submitMutation = useMutation({
    mutationFn: () =>
      submitReviewFn({
        data: {
          reservation_number: reservationNumber.trim(),
          contact_number: contactNumber.trim(),
          rating,
          comment: comment.trim() || undefined,
          website,
        },
      }),
    onSuccess: async () => {
      setReservationNumber("");
      setContactNumber("");
      setContactNumberTouched(false);
      setRating(0);
      setComment("");
      setWebsite("");
      setSubmitted(true);
      toast.success("Your review has been published.");
      await queryClient.invalidateQueries({ queryKey: ["public-customer-reviews"] });
    },
  });
  const average =
    reviews.length > 0
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;
  const validContactNumber = /^\d{11}$/.test(contactNumber);

  const submitReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setContactNumberTouched(true);
    if (!validContactNumber || !reservationNumber.trim() || rating === 0) return;
    setSubmitted(false);
    submitMutation.mutate();
  };

  return (
    <section id="customer-reviews" className="mx-auto max-w-7xl space-y-6 py-12 sm:py-16">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Your experience matters</p>
          <h2 className="mt-1 font-display text-3xl font-bold">Customer Reviews</h2>
        </div>
        <div className="flex items-center gap-2" aria-live="polite">
          {reviews.length > 0 ? (
            <>
              <ReviewStars rating={Math.round(average)} size="h-5 w-5" />
              <span className="font-semibold">{average.toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">
                ({reviews.length} {reviews.length === 1 ? "review" : "reviews"})
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Be the first to leave a review.</span>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <div className="space-y-3">
          {isLoading ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Loading customer reviews...
              </CardContent>
            </Card>
          ) : isError ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <p role="alert" className="text-sm text-destructive">
                  Customer reviews could not be loaded.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : reviews.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No published reviews yet. Complete a reservation to share your experience.
              </CardContent>
            </Card>
          ) : (
            reviews.map((review) => (
              <Card key={review.id}>
                <CardContent className="space-y-2 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ReviewStars rating={review.rating} />
                      <span className="text-sm font-semibold">Verified customer</span>
                    </div>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={review.created_at}
                    >
                      {new Date(review.created_at).toLocaleDateString("en-PH", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </div>
                  {review.comment ? (
                    <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {review.comment}
                    </p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">Rated with no comment.</p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">Leave a review</CardTitle>
            <p className="text-sm text-muted-foreground">
              Reviews are available after a completed reservation. One review is allowed per
              reservation.
            </p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submitReview}>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Reservation number</span>
                <Input
                  autoComplete="off"
                  maxLength={30}
                  required
                  placeholder="e.g. R-0001"
                  value={reservationNumber}
                  onChange={(event) => setReservationNumber(event.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Reservation contact number</span>
                <Input
                  id="review-contact-number"
                  type="tel"
                  autoComplete="tel"
                  inputMode="numeric"
                  maxLength={11}
                  pattern="[0-9]{11}"
                  title="Contact number must be exactly 11 digits."
                  required
                  aria-invalid={contactNumberTouched && !validContactNumber}
                  aria-describedby="review-contact-number-error"
                  placeholder="Phone number used for the reservation"
                  value={contactNumber}
                  onBlur={() => setContactNumberTouched(true)}
                  onChange={(event) => {
                    setContactNumber(event.target.value.replace(/\D/g, "").slice(0, 11));
                  }}
                />
                {contactNumberTouched && !validContactNumber && (
                  <span
                    id="review-contact-number-error"
                    role="alert"
                    className="text-destructive"
                  >
                    Contact number must be exactly 11 digits.
                  </span>
                )}
              </label>
              <input
                type="text"
                name="website"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="absolute -left-[9999px] h-px w-px overflow-hidden"
              />
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Your rating</legend>
                <div className="flex items-center gap-1" role="group" aria-label="Choose a rating">
                  {Array.from({ length: 5 }, (_, index) => {
                    const value = index + 1;
                    return (
                      <Button
                        key={value}
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-amber-500 hover:text-amber-600"
                        aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
                        aria-pressed={rating === value}
                        onClick={() => setRating(value)}
                      >
                        <Star
                          className={`h-6 w-6 ${value <= rating ? "fill-amber-400" : ""}`}
                          aria-hidden="true"
                        />
                      </Button>
                    );
                  })}
                  <span className="ml-2 text-sm text-muted-foreground">
                    {rating > 0 ? `${rating} out of 5` : "Select 1–5 stars"}
                  </span>
                </div>
              </fieldset>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">
                  Comment <span className="text-muted-foreground">(optional)</span>
                </span>
                <Textarea
                  maxLength={1000}
                  rows={4}
                  placeholder="Tell us about your Coffee Zone experience."
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
              </label>
              {submitMutation.error && (
                <p role="alert" className="text-sm text-destructive">
                  {submitMutation.error.message}
                </p>
              )}
              {submitted && (
                <p role="status" className="text-sm text-primary">
                  Thank you! Your review is now published in Customer Reviews.
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={
                  !validContactNumber ||
                  !reservationNumber.trim() ||
                  rating === 0 ||
                  submitMutation.isPending
                }
              >
                {submitMutation.isPending ? "Submitting review..." : "Submit review"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
