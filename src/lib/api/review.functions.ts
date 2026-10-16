import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasSupabaseServiceRole, supabaseAdmin } from "@/integrations/supabase/client.server";

const publicReviewSchema = z.object({
  id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  created_at: z.string(),
});

const submitReviewSchema = z.object({
  reservation_number: z.string().trim().min(1).max(30),
  contact_number: z.string().regex(/^[0-9]{11}$/, "Contact number must be exactly 11 digits."),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

const reviewStatusSchema = z.enum(["published", "hidden"]);

function requireReviewService() {
  if (!hasSupabaseServiceRole()) {
    throw new Error("Customer reviews are not configured on the server.");
  }
}

function requireSameOriginReviewRequest() {
  const request = getRequest();
  const origin = request?.headers.get("origin");
  if (!request || !origin) {
    throw new Error("Review submissions must come from this site.");
  }
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      throw new Error("Review submissions must come from this site.");
    }
  } catch {
    throw new Error("Review submissions must come from this site.");
  }
}

async function requireReviewAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) {
    console.error("[customer reviews] Unable to verify Admin role.", error);
    throw new Error("Your Admin permissions could not be verified.");
  }
  if (!data.some((entry) => entry.role === "admin")) {
    throw new Error("Forbidden: Admin access is required.");
  }
}

export const listPublicCustomerReviews = createServerFn({ method: "GET" }).handler(async () => {
  requireReviewService();
  const { data, error } = await supabaseAdmin
    .from("customer_reviews")
    .select("id, rating, comment, created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[customer reviews] Unable to load public reviews.", error);
    throw new Error("Customer reviews could not be loaded.");
  }
  return (data ?? []).map((review) => publicReviewSchema.parse(review));
});

export const submitCustomerReview = createServerFn({ method: "POST" })
  .validator((input) => submitReviewSchema.parse(input))
  .handler(async ({ data }) => {
    requireSameOriginReviewRequest();
    requireReviewService();
    const { data: result, error } = await supabaseAdmin.rpc("submit_customer_review", {
      p_reservation_number: data.reservation_number,
      p_contact_number: data.contact_number,
      p_rating: data.rating,
      p_comment: data.comment || null,
    });
    if (error) {
      const knownErrors = [
        "Contact number must be exactly 11 digits.",
        "A completed reservation with that reservation number and contact number was not found",
        "A review has already been submitted for this reservation",
        "Enter a valid reservation number, contact number, rating, and comment",
      ];
      const knownError = knownErrors.find((message) => error.message.includes(message));
      if (knownError) throw new Error(knownError);
      console.error("[customer reviews] Unable to submit review.", error);
      throw new Error("Your review could not be submitted. Please try again.");
    }
    if (
      typeof result !== "object" ||
      result === null ||
      !("id" in result) ||
      typeof result.id !== "string" ||
      !("status" in result) ||
      result.status !== "pending"
    ) {
      throw new Error("The review submission response was invalid.");
    }
    return { status: "pending" as const };
  });

export const listAdminCustomerReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireReviewService();
    await requireReviewAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("customer_reviews")
      .select("id, reservation_id, rating, comment, status, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[customer reviews] Unable to load Admin reviews.", error);
      throw new Error("Customer reviews could not be loaded.");
    }
    const reservationIds = [...new Set((data ?? []).map((review) => review.reservation_id))];
    const { data: reservations, error: reservationError } = reservationIds.length
      ? await supabaseAdmin
          .from("reservations")
          .select("id, reservation_number")
          .in("id", reservationIds)
      : { data: [], error: null };
    if (reservationError) {
      console.error("[customer reviews] Unable to load review reservation references.", reservationError);
      throw new Error("Review reservation details could not be loaded.");
    }
    const reservationNumbers = new Map(
      (reservations ?? []).map((reservation) => [reservation.id, reservation.reservation_number]),
    );
    return (data ?? []).map((review) => ({
      ...review,
      reservation_number: reservationNumbers.get(review.reservation_id) ?? "Unavailable",
    }));
  });

export const moderateCustomerReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ review_id: z.string().uuid(), status: reviewStatusSchema }).parse(input),
  )
  .handler(async ({ context, data }) => {
    requireReviewService();
    await requireReviewAdmin(context.userId);
    const { data: review, error } = await supabaseAdmin
      .from("customer_reviews")
      .update({ status: data.status })
      .eq("id", data.review_id)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[customer reviews] Unable to update review visibility.", error);
      throw new Error("The review visibility could not be updated.");
    }
    if (!review) throw new Error("The review could not be found.");
    return { id: review.id, status: data.status };
  });

export const removeCustomerReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ review_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    requireReviewService();
    await requireReviewAdmin(context.userId);
    const { data: review, error } = await supabaseAdmin
      .from("customer_reviews")
      .update({ status: "removed" })
      .eq("id", data.review_id)
      .select("id, status")
      .maybeSingle();
    if (error) {
      console.error("[customer reviews] Unable to remove review from public display.", error);
      throw new Error("The review could not be removed.");
    }
    if (!review) throw new Error("The review could not be found.");
    return { id: review.id, status: review.status };
  });
