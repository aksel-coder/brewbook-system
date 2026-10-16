import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { hasSupabaseServiceRole, supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireSupabaseServiceRoleKey } from "@/lib/supabase-env.server";

const PHOTO_BUCKET = "customer-photos";
const PAYMENT_BUCKET = "reservation-payment-evidence";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PAYMENT_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const photoTypeByExtension = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

const reservationSchema = z.object({
  customer_name: z.string().trim().min(1).max(120),
  contact_number: z.string().regex(/^[0-9]{11}$/, "Contact number must be exactly 11 digits."),
  pickup_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }),
  pickup_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  notes: z.string().max(1000),
  photo_path: z.string().regex(/^incoming\/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/i),
  photo_upload_proof: z.string().regex(/^\d+\.[0-9a-f]{64}$/i),
  payment_method: z.enum(["cash", "gcash"]),
  transaction_reference: z.string().trim().max(120).optional(),
  payment_screenshot_path: z
    .string()
    .regex(/^incoming\/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/i)
    .optional(),
  payment_screenshot_proof: z.string().regex(/^\d+\.[0-9a-f]{64}$/i).optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        variant_id: z.string().uuid().nullable(),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(30),
}).superRefine((data, context) => {
  if (data.payment_method === "gcash" && (!data.payment_screenshot_path || !data.payment_screenshot_proof)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payment_screenshot_path"],
      message: "Upload your GCash payment screenshot before submitting.",
    });
  }
  if (data.payment_method === "cash" && (data.payment_screenshot_path || data.payment_screenshot_proof || data.transaction_reference)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payment_method"],
      message: "Cash reservations cannot include GCash payment evidence.",
    });
  }
});

const reservationResultSchema = z.object({
  id: z.string().uuid(),
  reservation_number: z.string(),
  total_amount: z.number(),
  created_at: z.string(),
  payment_method: z.enum(["cash", "gcash"]),
  payment_status: z.enum(["awaiting_payment", "awaiting_verification", "paid", "rejected"]),
});

const publicReservationErrors = new Set([
  "Enter a valid customer name",
  "Contact number must be exactly 11 digits.",
  "Pickup date cannot be in the past",
  "Pickup time is required",
  "Invalid customer photo reference",
  "Notes must be 1000 characters or fewer",
  "Add between 1 and 30 reservation items",
  "Invalid reservation item",
  "Quantity must be between 1 and 100",
  "Invalid product variant",
  "Each product and variant can only appear once",
  "Product is unavailable",
  "Selected product variant is unavailable",
  "Select a product variant",
  "Selected product variant has no recipe",
  "Selected product variant has an invalid recipe",
  "Recipe-based product has no recipe",
  "Insufficient ingredient stock",
  "Insufficient product stock",
  "Upload your GCash payment screenshot before submitting.",
  "A valid GCash screenshot is required",
  "GCash payment screenshot upload has expired. Please upload it again.",
  "GCash payment screenshot could not be verified. Please upload it again.",
]);

function reportServerFailure(action: string, error: unknown) {
  console.error(`[customer reservations] ${action}`, error);
}

function getSafeReservationError(message: string) {
  return publicReservationErrors.has(message)
    ? message
    : "We couldn't complete your reservation. Please try again.";
}

function requireSameOriginRequest() {
  const request = getRequest();
  const origin = request?.headers.get("origin");
  if (!request || !origin) {
    throw new Error("Reservation requests must come from this site.");
  }
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      throw new Error("Reservation requests must come from this site.");
    }
  } catch {
    throw new Error("Reservation requests must come from this site.");
  }
}

function makeUploadProof(path: string, expiresAt: number) {
  const signature = createHmac("sha256", requireSupabaseServiceRoleKey())
    .update(`${path}:${expiresAt}`)
    .digest("hex");
  return `${expiresAt}.${signature}`;
}

function makePaymentUploadProof(path: string, expiresAt: number) {
  const signature = createHmac("sha256", requireSupabaseServiceRoleKey())
    .update(`reservation-payment:${path}:${expiresAt}`)
    .digest("hex");
  return `${expiresAt}.${signature}`;
}

function verifyPaymentUploadProof(path: string, proof: string) {
  const [expiresAtText, signature] = proof.split(".");
  const expiresAt = Number(expiresAtText);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    !/^[0-9a-f]{64}$/i.test(signature ?? "")
  ) return false;
  const expected = Buffer.from(makePaymentUploadProof(path, expiresAt).split(".")[1], "hex");
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function verifyUploadProof(path: string, proof: string) {
  const [expiresAtText, signature] = proof.split(".");
  const expiresAt = Number(expiresAtText);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    !/^[0-9a-f]{64}$/i.test(signature ?? "")
  ) {
    return false;
  }
  const expected = Buffer.from(makeUploadProof(path, expiresAt).split(".")[1], "hex");
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function hasExpectedImageSignature(bytes: Uint8Array, contentType: string, extension: string) {
  if (photoTypeByExtension[extension as keyof typeof photoTypeByExtension] !== contentType) {
    return false;
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    contentType === "image/webp" &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

async function getReservationByPhotoPath(path: string) {
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select("id, reservation_number, total_amount, created_at, customer_name, contact_number, pickup_date, pickup_time")
    .eq("customer_photo_path", path)
    .maybeSingle();
  if (error) {
    reportServerFailure("Unable to verify reservation.", error);
    throw new Error("We couldn't verify the reservation. Please try again.");
  }
  return data;
}

async function assertReservationMatches(
  reservation: NonNullable<Awaited<ReturnType<typeof getReservationByPhotoPath>>>,
  data: z.infer<typeof reservationSchema>,
) {
  if (
    reservation.customer_name !== data.customer_name ||
    reservation.contact_number !== data.contact_number ||
    reservation.pickup_date !== data.pickup_date ||
    reservation.pickup_time !== data.pickup_time
  ) throw new Error("This uploaded customer photo was already used for a different reservation.");

  const { data: savedItems, error } = await supabaseAdmin
    .from("reservation_items")
    .select("product_id, product_variant_id, quantity")
    .eq("reservation_id", reservation.id);
  if (error) {
    reportServerFailure("Unable to verify existing reservation items.", error);
    throw new Error("We couldn't verify the reservation. Please try again.");
  }
  const requested = data.items
    .map(item => `${item.product_id}:${item.variant_id ?? ""}:${item.quantity}`)
    .sort();
  const existing = (savedItems ?? [])
    .map(item => `${item.product_id ?? ""}:${item.product_variant_id ?? ""}:${item.quantity}`)
    .sort();
  if (requested.length !== existing.length || requested.some((item, index) => item !== existing[index])) {
    throw new Error("This uploaded customer photo was already used for a different reservation.");
  }
}

async function authorizeReservationAdmin(userId: string) {
  if (!hasSupabaseServiceRole()) {
    throw new Error("Reservation management is not configured on the server.");
  }
  const { data: roles, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (roleError) {
    reportServerFailure("Unable to verify reservation staff role.", roleError);
    throw new Error("Reservation access could not be verified.");
  }
  if (roles?.some((entry) => entry.role === "admin")) return;
  throw new Error("Forbidden: Admin access is required.");
}

export const createCustomerPhotoUpload = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
        file_name: z.string().max(255),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    requireSameOriginRequest();
    if (!hasSupabaseServiceRole()) {
      throw new Error("Customer reservations are not configured on the server.");
    }
    const extension = data.file_name.split(".").pop()?.toLowerCase() ?? "";
    if (
      !(extension in photoTypeByExtension) ||
      photoTypeByExtension[extension as keyof typeof photoTypeByExtension] !== data.content_type
    ) {
      throw new Error("The captured photo must be a JPEG, PNG, or WebP image.");
    }

    const path = `incoming/${randomUUID()}.${extension}`;
    const { data: signedUpload, error } = await supabaseAdmin.storage
      .from(PHOTO_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (error) {
      reportServerFailure("Unable to create customer photo upload.", error);
      throw new Error("The customer photo upload could not be started. Please try again.");
    }

    const expiresAt = Date.now() + 15 * 60 * 1000;
    return {
      path: signedUpload.path,
      token: signedUpload.token,
      proof: makeUploadProof(signedUpload.path, expiresAt),
    };
  });

export const createPaymentScreenshotUpload = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({
      content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
      file_name: z.string().max(255),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    requireSameOriginRequest();
    if (!hasSupabaseServiceRole()) {
      throw new Error("Customer reservations are not configured on the server.");
    }
    const extension = data.file_name.split(".").pop()?.toLowerCase() ?? "";
    if (
      !(extension in photoTypeByExtension) ||
      photoTypeByExtension[extension as keyof typeof photoTypeByExtension] !== data.content_type
    ) {
      throw new Error("The GCash screenshot must be a JPEG, PNG, or WebP image.");
    }

    const path = `incoming/${randomUUID()}.${extension}`;
    const { data: signedUpload, error } = await supabaseAdmin.storage
      .from(PAYMENT_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (error) {
      reportServerFailure("Unable to create GCash screenshot upload.", error);
      throw new Error("The GCash screenshot upload could not be started. Please try again.");
    }

    const expiresAt = Date.now() + 15 * 60 * 1000;
    return {
      path: signedUpload.path,
      token: signedUpload.token,
      proof: makePaymentUploadProof(signedUpload.path, expiresAt),
    };
  });

export const createCustomerReservation = createServerFn({ method: "POST" })
  .inputValidator((data) => reservationSchema.parse(data))
  .handler(async ({ data }) => {
    requireSameOriginRequest();
    if (!hasSupabaseServiceRole()) {
      throw new Error("Customer reservations are not configured on the server.");
    }
    if (!verifyUploadProof(data.photo_path, data.photo_upload_proof)) {
      throw new Error("The customer photo upload has expired. Please take the photo again.");
    }

    const extension = data.photo_path.split(".").pop()?.toLowerCase() ?? "";
    const expectedContentType =
      photoTypeByExtension[extension as keyof typeof photoTypeByExtension];
    let existingReservation = await getReservationByPhotoPath(data.photo_path);
    if (existingReservation) {
      await assertReservationMatches(existingReservation, data);
    } else {
      const { data: photo, error: photoError } = await supabaseAdmin.storage
        .from(PHOTO_BUCKET)
        .download(data.photo_path);
      if (photoError || !photo) {
        throw new Error(
          "The customer photo upload could not be verified. Please take the photo again.",
        );
      }
      if (photo.size > MAX_PHOTO_BYTES) {
        await removeRejectedPhoto(data.photo_path, "The customer photo must be 5 MB or smaller.");
      }
      const photoBytes = new Uint8Array(await photo.arrayBuffer());
      if (
        !hasExpectedImageSignature(photoBytes, photo.type, extension) ||
        photo.type !== expectedContentType
      ) {
        await removeRejectedPhoto(
          data.photo_path,
          "The uploaded file is not a supported customer photo.",
        );
      }
    }

    if (data.payment_method === "gcash") {
      if (
        !data.payment_screenshot_path ||
        !data.payment_screenshot_proof ||
        !verifyPaymentUploadProof(data.payment_screenshot_path, data.payment_screenshot_proof)
      ) {
        throw new Error("GCash payment screenshot upload has expired. Please upload it again.");
      }
      const screenshotExtension = data.payment_screenshot_path.split(".").pop()?.toLowerCase() ?? "";
      const expectedScreenshotType =
        photoTypeByExtension[screenshotExtension as keyof typeof photoTypeByExtension];
      const { data: screenshot, error: screenshotError } = await supabaseAdmin.storage
        .from(PAYMENT_BUCKET)
        .download(data.payment_screenshot_path);
      if (screenshotError || !screenshot) {
        throw new Error("GCash payment screenshot could not be verified. Please upload it again.");
      }
      if (screenshot.size > MAX_PAYMENT_SCREENSHOT_BYTES) {
        await removeRejectedPaymentScreenshot(
          data.payment_screenshot_path,
          "The GCash screenshot must be 5 MB or smaller.",
        );
      }
      if (
        screenshot.type !== expectedScreenshotType ||
        !hasExpectedImageSignature(
          new Uint8Array(await screenshot.arrayBuffer()),
          screenshot.type,
          screenshotExtension,
        )
      ) {
        await removeRejectedPaymentScreenshot(
          data.payment_screenshot_path,
          "The uploaded GCash screenshot is not a supported image.",
        );
      }
    }

    if (!existingReservation) {
      const { data: reservation, error } = await supabaseAdmin.rpc("create_customer_reservation", {
        p_customer_name: data.customer_name,
        p_contact_number: data.contact_number,
        p_pickup_date: data.pickup_date,
        p_pickup_time: data.pickup_time,
        p_customer_photo_path: data.photo_path,
        p_notes: data.notes,
        p_items: data.items.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: item.quantity,
        })),
      });
      if (error) {
        existingReservation = await getReservationByPhotoPath(data.photo_path);
        if (existingReservation) {
          await assertReservationMatches(existingReservation, data);
        } else {
          const { error: cleanupError } = await supabaseAdmin.storage
            .from(PHOTO_BUCKET)
            .remove([data.photo_path]);
          if (cleanupError) reportServerFailure("Unable to remove temporary customer photo.", cleanupError);
          if (data.payment_screenshot_path) {
            const { error: screenshotCleanupError } = await supabaseAdmin.storage
              .from(PAYMENT_BUCKET)
              .remove([data.payment_screenshot_path]);
            if (screenshotCleanupError) {
              reportServerFailure("Unable to remove temporary GCash screenshot.", screenshotCleanupError);
            }
          }
          reportServerFailure("Unable to create customer reservation.", error);
          throw new Error(getSafeReservationError(error.message));
        }
      } else {
        const parsedReservation = reservationResultSchema.omit({
          payment_method: true,
          payment_status: true,
        }).safeParse(reservation);
        if (!parsedReservation.success) throw new Error("The reservation response was invalid.");
        existingReservation = {
          ...parsedReservation.data,
          customer_name: data.customer_name,
          contact_number: data.contact_number,
          pickup_date: data.pickup_date,
          pickup_time: data.pickup_time,
        };
      }
    }

    const { data: payment, error: paymentError } = await supabaseAdmin.rpc(
      "record_reservation_payment_submission",
      {
        p_reservation_id: existingReservation.id,
        p_payment_method: data.payment_method,
        p_transaction_reference: data.payment_method === "gcash"
          ? data.transaction_reference?.trim() || null
          : null,
        p_screenshot_path: data.payment_method === "gcash"
          ? data.payment_screenshot_path!
          : null,
      },
    );
    if (paymentError) {
      reportServerFailure("Unable to record reservation payment submission.", paymentError);
      throw new Error(paymentError.message.includes("already exists")
        ? "A payment submission already exists for this reservation."
        : "The reservation was saved, but its payment could not be recorded. Retry the submission.");
    }
    const parsedPayment = z.object({
      payment_method: z.enum(["cash", "gcash"]),
      payment_status: z.enum(["awaiting_payment", "awaiting_verification", "paid", "rejected"]),
    }).safeParse(payment);
    if (!parsedPayment.success) {
      reportServerFailure("Reservation payment response was invalid.", parsedPayment.error);
      throw new Error("The reservation payment could not be verified.");
    }
    const result = reservationResultSchema.safeParse({
      ...existingReservation,
      ...parsedPayment.data,
    });
    if (!result.success) throw new Error("The reservation response was invalid.");
    return result.data;
  });

async function removeRejectedPhoto(path: string, reason: string): Promise<never> {
  const { error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) {
    reportServerFailure("Unable to remove rejected customer photo.", error);
    throw new Error(`${reason} We couldn't remove the invalid upload; please contact the shop.`);
  }
  throw new Error(reason);
}

async function removeRejectedPaymentScreenshot(path: string, reason: string): Promise<never> {
  const { error } = await supabaseAdmin.storage.from(PAYMENT_BUCKET).remove([path]);
  if (error) {
    reportServerFailure("Unable to remove rejected GCash screenshot.", error);
    throw new Error(`${reason} We couldn't remove the invalid upload; please contact the shop.`);
  }
  throw new Error(reason);
}

export const listCustomerReservations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await authorizeReservationAdmin(context.userId);

    const { data: reservations, error } = await supabaseAdmin
      .from("reservations")
      .select(
        "id, reservation_number, customer_name, contact_number, pickup_date, pickup_time, total_amount, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      reportServerFailure("Unable to retrieve reservations.", error);
      throw new Error("Reservations could not be loaded.");
    }
    if (!reservations?.length) return [];

    const { data: sales, error: salesError } = await supabaseAdmin
      .from("sales")
      .select("reservation_id, receipt_number, total_amount, sale_date")
      .in(
        "reservation_id",
        reservations.map((reservation) => reservation.id),
      );
    if (salesError) {
      reportServerFailure("Unable to retrieve reservation sale links.", salesError);
      throw new Error("Reservation sale information could not be loaded.");
    }
    const { data: payments, error: paymentsError } = await supabaseAdmin
      .from("reservation_payments")
      .select("reservation_id, payment_method, payment_status, transaction_reference, rejection_reason, verified_at")
      .in("reservation_id", reservations.map((reservation) => reservation.id));
    if (paymentsError) {
      reportServerFailure("Unable to retrieve reservation payment information.", paymentsError);
      throw new Error("Reservation payment information could not be loaded.");
    }
    const saleByReservation = new Map(
      (sales ?? []).map((sale) => [sale.reservation_id, sale]),
    );
    const paymentByReservation = new Map(
      (payments ?? []).map((payment) => [payment.reservation_id, payment]),
    );
    return (reservations ?? []).map((reservation) => ({
      ...reservation,
      sale: saleByReservation.get(reservation.id) ?? null,
      payment: paymentByReservation.get(reservation.id) ?? null,
    }));
  });

export const getCustomerReservation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ reservation_id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await authorizeReservationAdmin(context.userId);

    const { data: reservation, error } = await supabaseAdmin
      .from("reservations")
      .select(
        "id, reservation_number, customer_name, contact_number, pickup_date, pickup_time, notes, total_amount, status, created_at",
      )
      .eq("id", data.reservation_id)
      .maybeSingle();
    if (error) {
      reportServerFailure("Unable to retrieve reservation details.", error);
      throw new Error("Reservation details could not be loaded.");
    }
    if (!reservation) throw new Error("Reservation not found.");

    const { data: items, error: itemsError } = await supabaseAdmin
      .from("reservation_items")
      .select("id, product_name, variant_name, quantity, unit_price, subtotal")
      .eq("reservation_id", data.reservation_id)
      .order("created_at", { ascending: true });
    if (itemsError) {
      reportServerFailure("Unable to retrieve reservation items.", itemsError);
      throw new Error("Reservation items could not be loaded.");
    }

    const { data: sale, error: saleError } = await supabaseAdmin
      .from("sales")
      .select("receipt_number, total_amount, sale_date")
      .eq("reservation_id", data.reservation_id)
      .maybeSingle();
    if (saleError) {
      reportServerFailure("Unable to retrieve reservation sale link.", saleError);
      throw new Error("Reservation sale information could not be loaded.");
    }

    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("reservation_payments")
      .select("reservation_id, payment_method, payment_status, transaction_reference, screenshot_path, rejection_reason, verified_by, verified_at, created_at, updated_at")
      .eq("reservation_id", data.reservation_id)
      .maybeSingle();
    if (paymentError) {
      reportServerFailure("Unable to retrieve reservation payment information.", paymentError);
      throw new Error("Reservation payment information could not be loaded.");
    }

    const { data: paymentEvents, error: paymentEventsError } = await supabaseAdmin
      .from("reservation_payment_events")
      .select("id, payment_method, payment_status, transaction_reference, rejection_reason, changed_by_role, created_at")
      .eq("reservation_id", data.reservation_id)
      .order("created_at", { ascending: true });
    if (paymentEventsError) {
      reportServerFailure("Unable to retrieve reservation payment history.", paymentEventsError);
      throw new Error("Reservation payment history could not be loaded.");
    }

    return {
      ...reservation,
      items: items ?? [],
      sale: sale ?? null,
      payment: payment ? { ...payment, history: paymentEvents ?? [] } : null,
    };
  });

export const verifyCustomerReservationPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({
      reservation_id: z.string().uuid(),
      action: z.enum(["confirm_gcash", "reject_gcash", "mark_cash_paid"]),
      reason: z.string().trim().max(500).optional(),
    }).superRefine((data, context) => {
      if (data.action === "reject_gcash" && !data.reason) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reason"],
          message: "A rejection reason is required.",
        });
      }
    }).parse(data),
  )
  .handler(async ({ context, data }) => {
    await authorizeReservationAdmin(context.userId);
    const { data: payment, error } = await supabaseAdmin.rpc("verify_reservation_payment", {
      p_reservation_id: data.reservation_id,
      p_actor_user_id: context.userId,
      p_action: data.action,
      p_reason: data.reason ?? null,
    });
    if (error) {
      reportServerFailure("Unable to update reservation payment.", error);
      if (error.message.includes("not awaiting") || error.message.includes("not awaiting payment")) {
        throw new Error("This payment has already been reviewed. Refresh the reservation.");
      }
      throw new Error("The payment could not be updated. Refresh and try again.");
    }
    return payment;
  });

export const createReservationPaymentEvidenceReadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ reservation_id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await authorizeReservationAdmin(context.userId);
    const { data: payment, error } = await supabaseAdmin
      .from("reservation_payments")
      .select("screenshot_path")
      .eq("reservation_id", data.reservation_id)
      .single();
    if (error) {
      reportServerFailure("Unable to retrieve payment evidence reference.", error);
      throw new Error("The payment screenshot could not be loaded.");
    }
    if (!payment.screenshot_path) throw new Error("No GCash screenshot is attached to this reservation.");
    const { data: signedEvidence, error: signedEvidenceError } = await supabaseAdmin.storage
      .from(PAYMENT_BUCKET)
      .createSignedUrl(payment.screenshot_path, 60);
    if (signedEvidenceError) {
      reportServerFailure("Unable to create payment evidence URL.", signedEvidenceError);
      throw new Error("The payment screenshot could not be opened.");
    }
    return { signed_url: signedEvidence.signedUrl };
  });

export const completeCustomerReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ reservation_id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await authorizeReservationAdmin(context.userId);

    const { data: reservation, error: readError } = await supabaseAdmin
      .from("reservations")
      .select("reservation_number")
      .eq("id", data.reservation_id)
      .maybeSingle();
    if (readError) {
      reportServerFailure("Unable to verify reservation.", readError);
      throw new Error("The reservation could not be verified.");
    }
    if (!reservation) throw new Error("Reservation not found.");

    const { data: checkout, error: checkoutError } = await supabaseAdmin.rpc(
      "process_sale_checkout",
      {
        p_user_id: context.userId,
        p_receipt_number: null,
        p_reservation_id: data.reservation_id,
        p_items: [],
      },
    );
    if (checkoutError) {
      reportServerFailure("Unable to complete reservation sale.", checkoutError);
      if (
        checkoutError.message.includes("Insufficient product stock") ||
        checkoutError.message.includes("Insufficient ingredient stock")
      ) {
        throw new Error(
          "There is not enough current stock to complete this reservation. Review inventory and try again.",
        );
      }
      const safeErrors: Record<string, string> = {
        "Reservation must be ready for pickup before completion":
          "The reservation checkout database update is not applied. Ask an administrator to apply migration 20261009113200_restore_reservation_status_processing.sql.",
        "A reserved product is no longer available":
          "A reserved product is no longer available. The reservation remains pending.",
        "A reserved product variant is no longer available":
          "A reserved product variant is no longer available. The reservation remains pending.",
        "Reservation is not pending":
          "This reservation has already been processed. Refresh to see its sale.",
        "Reservation has no items":
          "This reservation has no items to process.",
        "Reservation payment must be verified before completion":
          "Verify or record payment before completing this reservation.",
        "Reservation not found": "This reservation could not be found.",
      };
      const safeMessage = safeErrors[checkoutError.message];
      if (safeMessage) throw new Error(safeMessage);
      throw new Error("The reservation could not be completed. Please refresh and try again.");
    }
    const result = z
      .object({
        sale: z.object({
          receipt_number: z.string(),
          total_amount: z.number(),
        }),
      })
      .safeParse(checkout);
    if (!result.success) {
      reportServerFailure("Reservation sale response was invalid.", result.error);
      throw new Error("The reservation completion could not be verified.");
    }
    return {
      reservation_number: reservation.reservation_number,
      sale_receipt_number: result.data.sale.receipt_number,
      total_amount: result.data.sale.total_amount,
    };
  });

export const createCustomerPhotoReadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ reservation_id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await authorizeReservationAdmin(context.userId);

    const { data: reservation, error } = await supabaseAdmin
      .from("reservations")
      .select("customer_photo_path")
      .eq("id", data.reservation_id)
      .single();
    if (error) {
      reportServerFailure("Unable to retrieve reservation photo reference.", error);
      throw new Error("The customer photo could not be loaded.");
    }
    const { data: signedPhoto, error: signedPhotoError } = await supabaseAdmin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(reservation.customer_photo_path, 60);
    if (signedPhotoError) {
      reportServerFailure("Unable to create reservation photo URL.", signedPhotoError);
      throw new Error("The customer photo could not be opened.");
    }
    return { signed_url: signedPhoto.signedUrl };
  });
