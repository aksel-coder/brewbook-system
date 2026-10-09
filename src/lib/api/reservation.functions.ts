import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { hasSupabaseServiceRole, supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireSupabaseServiceRoleKey } from "@/lib/supabase-env.server";

const PHOTO_BUCKET = "customer-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const photoTypeByExtension = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

const reservationSchema = z.object({
  customer_name: z.string().trim().min(1).max(120),
  contact_number: z.string().regex(/^\d{11}$/, "Contact number must be exactly 11 digits."),
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
});

const reservationResultSchema = z.object({
  reservation_number: z.string(),
  total_amount: z.number(),
  created_at: z.string(),
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
    .select("reservation_number, total_amount, created_at")
    .eq("customer_photo_path", path)
    .maybeSingle();
  if (error) {
    reportServerFailure("Unable to verify reservation.", error);
    throw new Error("We couldn't verify the reservation. Please try again.");
  }
  return data;
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

    const existingReservation = await getReservationByPhotoPath(data.photo_path);
    if (existingReservation) return existingReservation;

    const extension = data.photo_path.split(".").pop()?.toLowerCase() ?? "";
    const expectedContentType =
      photoTypeByExtension[extension as keyof typeof photoTypeByExtension];
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
      const reservationAfterError = await getReservationByPhotoPath(data.photo_path);
      if (reservationAfterError) return reservationAfterError;
      const { error: cleanupError } = await supabaseAdmin.storage
        .from(PHOTO_BUCKET)
        .remove([data.photo_path]);
      if (cleanupError) {
        reportServerFailure("Unable to remove temporary customer photo.", cleanupError);
      }
      reportServerFailure("Unable to create customer reservation.", error);
      throw new Error(getSafeReservationError(error.message));
    }
    const result = reservationResultSchema.safeParse(reservation);
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
    const saleByReservation = new Map(
      (sales ?? []).map((sale) => [sale.reservation_id, sale]),
    );
    return (reservations ?? []).map((reservation) => ({
      ...reservation,
      sale: saleByReservation.get(reservation.id) ?? null,
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

    return {
      ...reservation,
      items: items ?? [],
      sale: sale ?? null,
    };
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
