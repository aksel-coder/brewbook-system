import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Coffee,
  ImagePlus,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { listCustomerCatalog, type CustomerCatalogProduct } from "@/lib/api/customer.functions";
import {
  createCustomerPhotoUpload,
  createCustomerReservation,
} from "@/lib/api/reservation.functions";

export const Route = createFileRoute("/customer")({
  head: () => ({
    meta: [
      { title: "Coffee Zone Menu" },
      {
        name: "description",
        content: "Browse the Coffee Zone menu and explore available drinks and treats.",
      },
    ],
  }),
  component: CustomerPage,
});

type CartItem = {
  key: string;
  productId: string;
  variantId: string | null;
  quantity: number;
};

type CustomerCartLine = CartItem & {
  name: string;
  variantName: string | null;
  unitPrice: number;
  availableStock: number;
};

const peso = (amount: number) =>
  "₱" +
  Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ReservationCartSummary({
  cartLines,
  cartTotal,
}: {
  cartLines: CustomerCartLine[];
  cartTotal: number;
}) {
  return (
    <div id="cart" className="scroll-mt-24">
      {cartLines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your cart is empty.</p>
      ) : (
        <ul className="divide-y">
          {cartLines.map((item) => (
            <li key={item.key} className="flex justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{item.name}</p>
                {item.variantName && (
                  <p className="text-xs text-muted-foreground">{item.variantName}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.quantity} × {peso(item.unitPrice)}
                </p>
              </div>
              <span className="shrink-0 font-medium">{peso(item.unitPrice * item.quantity)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between border-t pt-4 font-semibold">
        <span>Cart total</span>
        <span>{peso(cartTotal)}</span>
      </div>
    </div>
  );
}

const MAX_CUSTOMER_PHOTO_BYTES = 5 * 1024 * 1024;
const CUSTOMER_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

type CustomerReservationReceipt = {
  reservation_number: string;
  total_amount: number;
  pickup_date: string;
  pickup_time: string;
};

type CustomerPhotoUploadAttempt = {
  file: File;
  path: string;
  token: string;
  proof: string;
};

const CUSTOMER_SUBMISSION_ERRORS = new Set([
  "Choose a JPG, PNG, or WebP customer photo.",
  "The customer photo upload has expired. Please select the photo again.",
  "The customer photo upload could not be verified. Please upload it again.",
  "Enter a valid customer name",
  "Enter a valid contact number",
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

function getCustomerSubmissionError(error: unknown) {
  if (
    error instanceof Error &&
    (error.message === "Insufficient ingredient stock" ||
      error.message === "Insufficient product stock")
  ) {
    return "Some selected products are no longer available in the requested quantity. Please update your cart and try again.";
  }
  if (error instanceof Error && CUSTOMER_SUBMISSION_ERRORS.has(error.message)) {
    return error.message;
  }
  return "We couldn't submit your reservation. Please check your connection and try again.";
}

function getCustomerPhotoContentType(file: File): "image/jpeg" | "image/png" | "image/webp" | null {
  if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") {
    return file.type;
  }
  return null;
}

function getLocalDateString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function CustomerPage() {
  const catalogFn = useServerFn(listCustomerCatalog);
  const createPhotoUploadFn = useServerFn(createCustomerPhotoUpload);
  const createReservationFn = useServerFn(createCustomerReservation);
  const {
    data: products = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["customerCatalog"],
    queryFn: () => catalogFn(),
  });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, string>>({});
  const [reservationOpen, setReservationOpen] = useState(false);
  const [showReservationReview, setShowReservationReview] = useState(false);
  const [fullName, setFullName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [notes, setNotes] = useState("");
  const [customerPhoto, setCustomerPhoto] = useState<File | null>(null);
  const [customerPhotoUrl, setCustomerPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [isSubmittingReservation, setIsSubmittingReservation] = useState(false);
  const [reservationError, setReservationError] = useState("");
  const [reservationReceipt, setReservationReceipt] = useState<CustomerReservationReceipt | null>(
    null,
  );
  const photoInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingReservationRef = useRef(false);
  const customerPhotoUploadAttemptRef = useRef<CustomerPhotoUploadAttempt | null>(null);

  useEffect(() => {
    if (!customerPhoto) {
      setCustomerPhotoUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(customerPhoto);
    setCustomerPhotoUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [customerPhoto]);

  const handleCustomerPhoto = (file: File | undefined) => {
    if (!file) return;
    if (!CUSTOMER_PHOTO_TYPES.includes(file.type)) {
      setPhotoError("Choose a JPG, PNG, or WebP image.");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_CUSTOMER_PHOTO_BYTES) {
      setPhotoError("The customer photo must be 5 MB or smaller.");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    setCustomerPhoto(file);
    customerPhotoUploadAttemptRef.current = null;
    setPhotoError("");
  };

  const continueToReservationReview = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (!customerPhoto) {
      setPhotoError("A customer photo is required.");
      photoInputRef.current?.focus();
      return;
    }
    setPhotoError("");
    setReservationError("");
    setShowReservationReview(true);
  };

  const submitReservation = async () => {
    if (isSubmittingReservationRef.current) return;
    const contentType = customerPhoto ? getCustomerPhotoContentType(customerPhoto) : null;
    if (!customerPhoto || !contentType) {
      setPhotoError("Choose a JPG, PNG, or WebP customer photo.");
      return;
    }
    if (cartLines.length === 0) {
      setReservationError("Your cart is empty. Add at least one item before reserving.");
      return;
    }

    isSubmittingReservationRef.current = true;
    setIsSubmittingReservation(true);
    setReservationError("");
    try {
      let upload = customerPhotoUploadAttemptRef.current;
      if (!upload || upload.file !== customerPhoto) {
        const uploadCredential = await createPhotoUploadFn({
          data: {
            content_type: contentType,
            file_name: customerPhoto.name,
          },
        });
        const { error: uploadError } = await supabase.storage
          .from("customer-photos")
          .uploadToSignedUrl(uploadCredential.path, uploadCredential.token, customerPhoto, {
            contentType,
            upsert: false,
          });
        if (uploadError) throw new Error("Customer photo upload failed. Please try again.");
        upload = {
          file: customerPhoto,
          path: uploadCredential.path,
          token: uploadCredential.token,
          proof: uploadCredential.proof,
        };
        customerPhotoUploadAttemptRef.current = upload;
      }

      const reservation = await createReservationFn({
        data: {
          customer_name: fullName,
          contact_number: contactNumber,
          pickup_date: pickupDate,
          pickup_time: pickupTime,
          notes,
          photo_path: upload.path,
          photo_upload_proof: upload.proof,
          items: cartLines.map((item) => ({
            product_id: item.productId,
            variant_id: item.variantId,
            quantity: item.quantity,
          })),
        },
      });
      setReservationReceipt({
        reservation_number: reservation.reservation_number,
        total_amount: Number(reservation.total_amount),
        pickup_date: pickupDate,
        pickup_time: pickupTime,
      });
      customerPhotoUploadAttemptRef.current = null;
      setCart([]);
      setCustomerPhoto(null);
      if (photoInputRef.current) photoInputRef.current.value = "";
      setFullName("");
      setContactNumber("");
      setPickupDate("");
      setPickupTime("");
      setNotes("");
      setShowReservationReview(false);
    } catch (error) {
      const customerMessage = getCustomerSubmissionError(error);
      if (
        error instanceof Error &&
        (error.message === "Insufficient ingredient stock" ||
          error.message === "Insufficient product stock" ||
          error.message === "Product is unavailable" ||
          error.message === "Selected product variant is unavailable")
      ) {
        void refetch();
      }
      if (CUSTOMER_SUBMISSION_ERRORS.has(customerMessage)) {
        customerPhotoUploadAttemptRef.current = null;
      }
      setReservationError(customerMessage);
    } finally {
      isSubmittingReservationRef.current = false;
      setIsSubmittingReservation(false);
    }
  };

  const openReservation = () => {
    setReservationOpen(true);
    setShowReservationReview(false);
    setReservationError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const categories = useMemo(
    () => [
      "All",
      ...new Set(
        products
          .map((product) => product.category)
          .filter((value): value is string => Boolean(value)),
      ),
    ],
    [products],
  );
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const matchesSearch =
        !query || `${product.name} ${product.description ?? ""}`.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [products, search, category]);

  const stockForSelection = (product: CustomerCatalogProduct, variantId: string | null) => {
    if (!variantId) return product.available_stock;
    return product.variants.find((variant) => variant.id === variantId)?.available_stock ?? 0;
  };

  const quantityInCart = (productId: string, variantId: string | null) =>
    cart.find((item) => item.productId === productId && item.variantId === variantId)?.quantity ??
    0;

  const addToCart = (product: CustomerCatalogProduct) => {
    const variantId = product.variants.length > 0 ? selectedVariants[product.id] : null;
    if (product.variants.length > 0 && !variantId) return;
    const requested = Number(selectedQuantities[product.id] ?? 1);
    const available = stockForSelection(product, variantId ?? null);
    const alreadyInCart = quantityInCart(product.id, variantId ?? null);
    if (!Number.isInteger(requested) || requested < 1 || requested + alreadyInCart > available)
      return;

    const key = `${product.id}:${variantId ?? "default"}`;
    setCart((current) => {
      const existing = current.find((item) => item.key === key);
      if (existing) {
        return current.map((item) =>
          item.key === key ? { ...item, quantity: item.quantity + requested } : item,
        );
      }
      return [
        ...current,
        { key, productId: product.id, variantId: variantId ?? null, quantity: requested },
      ];
    });
    setSelectedQuantities((current) => ({ ...current, [product.id]: "1" }));
  };

  const changeQuantity = (item: CartItem, amount: number) => {
    const product = products.find((entry) => entry.id === item.productId);
    if (!product) return;
    setCart((current) =>
      current
        .map((entry) =>
          entry.key === item.key
            ? {
                ...entry,
                quantity: Math.min(
                  stockForSelection(product, entry.variantId),
                  entry.quantity + amount,
                ),
              }
            : entry,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const catalogById = new Map(products.map((product) => [product.id, product]));
  const cartLines = cart.flatMap((item) => {
    const product = catalogById.get(item.productId);
    if (!product) return [];
    const variant = item.variantId
      ? product.variants.find((entry) => entry.id === item.variantId)
      : undefined;
    if (item.variantId && !variant) return [];
    return [
      {
        ...item,
        name: product.name,
        variantName: variant?.name ?? null,
        unitPrice: Number(variant?.price ?? product.price),
        availableStock: stockForSelection(product, item.variantId),
      },
    ];
  });
  const itemCount = cartLines.reduce((total, item) => total + item.quantity, 0);
  const cartTotal = cartLines.reduce((total, item) => total + item.unitPrice * item.quantity, 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <a href="/customer" className="flex min-w-0 items-center gap-2.5">
            <img
              src="/coffeLogo.jpg"
              alt="Coffee Zone"
              className="h-10 w-10 rounded-full bg-white object-cover"
            />
            <span className="truncate font-display text-lg font-bold">Coffee Zone</span>
          </a>
          <nav aria-label="Customer navigation" className="flex items-center gap-1 sm:gap-3">
            {reservationOpen ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReservationOpen(false)}
              >
                <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Menu</span>
              </Button>
            ) : (
              <a
                href="#menu"
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Menu
              </a>
            )}
            <a
              href="#cart"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <ShoppingBag className="h-4 w-4" />
              <span className="hidden sm:inline">Cart</span>
              <span
                aria-label={`${itemCount} items in cart`}
                className="rounded-full bg-primary-foreground/20 px-1.5 text-xs"
              >
                {itemCount}
              </span>
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
        {reservationOpen ? (
          <section id="reservation" className="mx-auto max-w-5xl space-y-6 py-8">
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-medium text-primary">
                <CalendarDays className="h-4 w-4" /> Pickup reservation
              </p>
              <h1 className="font-display text-3xl font-bold sm:text-4xl">
                {reservationReceipt
                  ? "Reservation Submitted Successfully"
                  : showReservationReview
                    ? "Review your reservation"
                    : "Reservation details"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {reservationReceipt
                  ? "Your reservation has been received and is waiting for confirmation."
                  : showReservationReview
                    ? "Review your details and items, then place your reservation."
                    : "Tell us who is picking up and when. Your cart will stay here while you fill this out."}
              </p>
            </div>

            {reservationReceipt ? (
              <Card className="mx-auto max-w-2xl">
                <CardHeader>
                  <CardTitle className="font-display">Reservation received</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <p className="text-sm text-muted-foreground">
                    Your reservation is waiting for confirmation. Keep this number for your pickup.
                  </p>
                  <div className="rounded-lg bg-secondary p-5 text-center">
                    <p className="text-sm text-muted-foreground">Reservation number</p>
                    <p className="mt-1 font-display text-3xl font-bold">
                      {reservationReceipt.reservation_number}
                    </p>
                  </div>
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">Pickup date</dt>
                      <dd className="font-medium">{reservationReceipt.pickup_date}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Pickup time</dt>
                      <dd className="font-medium">{reservationReceipt.pickup_time}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Total amount</dt>
                      <dd className="font-medium">{peso(reservationReceipt.total_amount)}</dd>
                    </div>
                  </dl>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => {
                      setReservationReceipt(null);
                      setReservationOpen(false);
                    }}
                  >
                    Back to menu
                  </Button>
                </CardContent>
              </Card>
            ) : showReservationReview ? (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display">Customer and pickup</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Full name</dt>
                        <dd className="font-medium">{fullName}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Contact number</dt>
                        <dd className="font-medium">{contactNumber}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Pickup date</dt>
                        <dd className="font-medium">{pickupDate}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Pickup time</dt>
                        <dd className="font-medium">{pickupTime}</dd>
                      </div>
                      {notes.trim() && (
                        <div className="sm:col-span-2">
                          <dt className="text-muted-foreground">Notes</dt>
                          <dd className="whitespace-pre-wrap font-medium">{notes.trim()}</dd>
                        </div>
                      )}
                    </dl>
                    {customerPhotoUrl && customerPhoto && (
                      <div className="border-t pt-4">
                        <p className="mb-2 text-sm text-muted-foreground">Customer photo</p>
                        <div className="flex items-center gap-3">
                          <img
                            src={customerPhotoUrl}
                            alt="Selected customer photo preview"
                            className="h-20 w-20 rounded-lg border object-cover"
                          />
                          <span className="break-all text-sm font-medium">
                            {customerPhoto.name}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isSubmittingReservation}
                        onClick={() => setShowReservationReview(false)}
                      >
                        <ArrowLeft className="h-4 w-4" /> Edit details
                      </Button>
                      <Button
                        type="button"
                        disabled={isSubmittingReservation}
                        onClick={submitReservation}
                      >
                        {isSubmittingReservation
                          ? "Submitting reservation..."
                          : "Submit Reservation"}
                      </Button>
                    </div>
                    {reservationError && (
                      <p role="alert" className="text-sm text-destructive">
                        {reservationError}
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="font-display">Items to reserve</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ReservationCartSummary cartLines={cartLines} cartTotal={cartTotal} />
                  </CardContent>
                </Card>
              </div>
            ) : (
              <form
                onSubmit={continueToReservationReview}
                className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display">Your details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-1.5 text-sm">
                        <span className="font-medium">
                          Full Name <span className="text-destructive">*</span>
                        </span>
                        <Input
                          autoComplete="name"
                          required
                          maxLength={120}
                          value={fullName}
                          onChange={(event) => setFullName(event.target.value)}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="font-medium">
                          Contact Number <span className="text-destructive">*</span>
                        </span>
                        <Input
                          type="tel"
                          autoComplete="tel"
                          inputMode="tel"
                          required
                          pattern="(?:[0-9]|\+|\(|\)| |\.|-){7,20}"
                          title="Enter a phone number using 7 to 20 digits or phone punctuation."
                          value={contactNumber}
                          onChange={(event) => setContactNumber(event.target.value)}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="font-medium">
                          Pickup Date <span className="text-destructive">*</span>
                        </span>
                        <Input
                          type="date"
                          required
                          min={getLocalDateString()}
                          value={pickupDate}
                          onChange={(event) => setPickupDate(event.target.value)}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="font-medium">
                          Pickup Time <span className="text-destructive">*</span>
                        </span>
                        <Input
                          type="time"
                          required
                          value={pickupTime}
                          onChange={(event) => setPickupTime(event.target.value)}
                        />
                      </label>
                    </div>

                    <div className="space-y-2 border-t pt-4">
                      <div>
                        <p className="text-sm font-medium">
                          Customer Photo <span className="text-destructive">*</span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          JPG, PNG, or WebP · up to 5 MB. No ID photo is needed.
                        </p>
                      </div>
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                        className="sr-only"
                        aria-label="Choose customer photo"
                        onChange={(event) => handleCustomerPhoto(event.target.files?.[0])}
                      />
                      {customerPhotoUrl && customerPhoto ? (
                        <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
                          <img
                            src={customerPhotoUrl}
                            alt="Selected customer photo preview"
                            className="h-28 w-28 rounded-md border object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="break-all text-sm font-medium">{customerPhoto.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {(customerPhoto.size / (1024 * 1024)).toFixed(2)} MB · Private photo
                              upload happens when you place the reservation.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => photoInputRef.current?.click()}
                              >
                                <Upload className="h-4 w-4" /> Replace photo
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setCustomerPhoto(null);
                                  customerPhotoUploadAttemptRef.current = null;
                                  setPhotoError("");
                                  if (photoInputRef.current) photoInputRef.current.value = "";
                                }}
                              >
                                <X className="h-4 w-4" /> Remove
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => photoInputRef.current?.click()}
                        >
                          <ImagePlus className="h-4 w-4" /> Choose customer photo
                        </Button>
                      )}
                      {photoError && (
                        <p role="alert" className="text-sm text-destructive">
                          {photoError}
                        </p>
                      )}
                    </div>

                    <label className="block space-y-1.5 border-t pt-4 text-sm">
                      <span className="font-medium">Optional Notes</span>
                      <Textarea
                        maxLength={1000}
                        rows={3}
                        placeholder="Anything else we should know?"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                    </label>

                    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setReservationOpen(false)}
                      >
                        <ArrowLeft className="h-4 w-4" /> Back to menu
                      </Button>
                      <Button type="submit">
                        Continue to review <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="font-display">Items to reserve</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ReservationCartSummary cartLines={cartLines} cartTotal={cartTotal} />
                  </CardContent>
                </Card>
              </form>
            )}
          </section>
        ) : (
          <>
            <section className="relative my-6 overflow-hidden rounded-2xl bg-secondary/50 px-5 py-10 sm:my-8 sm:px-10 sm:py-14">
              <div className="absolute -right-8 -top-16 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
              <div className="relative max-w-2xl">
                <p className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Coffee className="h-4 w-4" /> Start your day right
                </p>
                <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
                  Your Coffee Zone favorites, all in one place.
                </h1>
                <p className="mt-4 max-w-xl text-muted-foreground">
                  Browse our menu, explore drink sizes, and add something good to your cart.
                </p>
                <Button asChild className="mt-6">
                  <a href="#menu">
                    Explore the menu <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </section>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <section id="menu" className="min-w-0 scroll-mt-24 space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-primary">Made for your moment</p>
                    <h2 className="mt-1 font-display text-3xl font-bold">Our Menu</h2>
                  </div>
                  <Input
                    aria-label="Search menu"
                    placeholder="Search the menu..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="w-full sm:max-w-xs"
                  />
                </div>

                {categories.length > 1 && (
                  <div
                    className="flex gap-2 overflow-x-auto pb-1"
                    aria-label="Filter menu by category"
                  >
                    {categories.map((value) => (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant={category === value ? "default" : "outline"}
                        onClick={() => setCategory(value)}
                        className="shrink-0"
                      >
                        {value}
                      </Button>
                    ))}
                  </div>
                )}

                {isLoading ? (
                  <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                    Loading the menu...
                  </div>
                ) : isError ? (
                  <div className="rounded-xl border border-dashed p-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      The menu could not be loaded right now.
                    </p>
                    {error instanceof Error && (
                      <p className="mt-2 break-words text-xs text-destructive">{error.message}</p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => refetch()}
                    >
                      Try again
                    </Button>
                  </div>
                ) : visibleProducts.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                    {products.length === 0
                      ? "There are no menu items available right now."
                      : "No items match your search."}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {visibleProducts.map((product) => (
                      <Card
                        key={product.id}
                        className="overflow-hidden border-border/70 shadow-sm transition-shadow hover:shadow-md"
                      >
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="h-48 w-full bg-muted object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-48 items-center justify-center bg-secondary/60 text-primary/70">
                            <Coffee className="h-12 w-12" aria-hidden="true" />
                          </div>
                        )}
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="font-display text-xl font-semibold">{product.name}</h3>
                              {product.category && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {product.category}
                                </p>
                              )}
                            </div>
                            {product.variants.length === 0 && (
                              <span className="shrink-0 font-semibold text-primary">
                                {peso(product.price)}
                              </span>
                            )}
                          </div>
                          {product.description && (
                            <p className="line-clamp-2 text-sm text-muted-foreground">
                              {product.description}
                            </p>
                          )}
                          <div className="space-y-3 border-t pt-3">
                            {product.variants.length > 0 && (
                              <label className="block space-y-1.5 text-sm">
                                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Size
                                </span>
                                <select
                                  aria-label={`Choose size for ${product.name}`}
                                  value={selectedVariants[product.id] ?? ""}
                                  onChange={(event) =>
                                    setSelectedVariants((current) => ({
                                      ...current,
                                      [product.id]: event.target.value,
                                    }))
                                  }
                                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                >
                                  <option value="">Select a size</option>
                                  {product.variants.map((variant) => (
                                    <option
                                      key={variant.id}
                                      value={variant.id}
                                      disabled={variant.available_stock <= 0}
                                    >
                                      {variant.name} · {peso(variant.price)}
                                      {variant.available_stock <= 0 ? " · Unavailable" : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            {(() => {
                              const variantId =
                                product.variants.length > 0
                                  ? (selectedVariants[product.id] ?? "")
                                  : null;
                              const available = stockForSelection(product, variantId);
                              const inCart = quantityInCart(product.id, variantId);
                              const remaining = Math.max(0, available - inCart);
                              const requested = Number(selectedQuantities[product.id] ?? 1);
                              const selectedVariant = product.variants.find(
                                (variant) => variant.id === variantId,
                              );
                              const unitPrice = Number(selectedVariant?.price ?? product.price);
                              const hasSelection =
                                product.variants.length === 0 || Boolean(selectedVariant);
                              const canAdd =
                                available > 0 &&
                                Number.isInteger(requested) &&
                                requested > 0 &&
                                requested <= remaining &&
                                hasSelection;

                              return (
                                <>
                                  <div className="flex items-end gap-3">
                                    <label className="min-w-0 flex-1 space-y-1.5 text-sm">
                                      <span className="text-xs font-medium text-muted-foreground">
                                        Quantity
                                      </span>
                                      <Input
                                        aria-label={`Quantity for ${product.name}`}
                                        type="number"
                                        min={1}
                                        max={remaining}
                                        step={1}
                                        value={selectedQuantities[product.id] ?? "1"}
                                        disabled={remaining <= 0}
                                        onChange={(event) =>
                                          setSelectedQuantities((current) => ({
                                            ...current,
                                            [product.id]: event.target.value,
                                          }))
                                        }
                                      />
                                    </label>
                                    <span className="pb-2 text-xs text-muted-foreground">
                                      {!hasSelection
                                        ? "Choose a size"
                                        : remaining > 0
                                          ? `${remaining} available`
                                          : "Out of stock"}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {hasSelection
                                      ? `Unit price: ${peso(unitPrice)}`
                                      : "Select a size to see its price"}
                                  </p>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full"
                                    disabled={!canAdd}
                                    onClick={() => addToCart(product)}
                                  >
                                    <Plus className="h-4 w-4" />
                                    {!hasSelection
                                      ? "Choose a size"
                                      : remaining > 0
                                        ? "Add to cart"
                                        : "Unavailable"}
                                  </Button>
                                </>
                              );
                            })()}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              <Card id="cart" className="scroll-mt-24 lg:sticky lg:top-24">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="flex items-center gap-2 font-display text-xl">
                    <ShoppingBag className="h-5 w-5 text-primary" /> Your Cart
                  </CardTitle>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
                    {itemCount} {itemCount === 1 ? "item" : "items"}
                  </span>
                </CardHeader>
                <CardContent>
                  {cartLines.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-8 text-center">
                      <ShoppingBag className="mx-auto h-8 w-8 text-muted-foreground/60" />
                      <p className="mt-3 text-sm font-medium">Your cart is waiting</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Add a menu item to see it here.
                      </p>
                      <Button asChild variant="link" size="sm" className="mt-2">
                        <a href="#menu">
                          Browse menu <ArrowRight className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {cartLines.map((item) => (
                        <li key={item.key} className="flex gap-3 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.name}</p>
                            {item.variantName && (
                              <p className="text-xs text-muted-foreground">{item.variantName}</p>
                            )}
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.quantity} × {peso(item.unitPrice)}
                            </p>
                            <p className="mt-1 text-sm font-medium text-primary">
                              Subtotal: {peso(item.unitPrice * item.quantity)}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-7 w-7"
                                aria-label={`Remove one ${item.name}`}
                                onClick={() => changeQuantity(item, -1)}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="min-w-5 text-center text-sm">{item.quantity}</span>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-7 w-7"
                                aria-label={`Add one ${item.name}`}
                                disabled={item.quantity >= item.availableStock}
                                onClick={() => changeQuantity(item, 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="ml-auto h-7 w-7 text-destructive"
                                aria-label={`Remove ${item.name} from cart`}
                                onClick={() =>
                                  setCart((current) =>
                                    current.filter((entry) => entry.key !== item.key),
                                  )
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-4 space-y-3 border-t pt-4">
                    <div className="flex items-center justify-between font-semibold">
                      <span>Cart total</span>
                      <span>{peso(cartTotal)}</span>
                    </div>
                    <Button
                      type="button"
                      className="w-full"
                      disabled={cartLines.length === 0}
                      onClick={openReservation}
                    >
                      Proceed to Reservation <ArrowRight className="h-4 w-4" />
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Review your cart and pickup details before submitting your reservation.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        Coffee Zone · Start your day right
      </footer>
    </div>
  );
}
