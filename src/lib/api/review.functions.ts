import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
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
  website: z.string().max(0).optional(),
});

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
      result.status !== "published"
    ) {
      throw new Error("The review submission response was invalid.");
    }
    return { status: "published" as const };
  });
