export type CachedCategory = {
  id: string;
  name: string;
  created_at: string;
};

export type CachedProduct = {
  id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  price: number;
  cost: number;
  stock_quantity: number;
  low_stock_threshold: number;
  image_url: string | null;
  is_active: boolean;
  categories: CachedCategory | null;
  created_at?: string;
  updated_at?: string;
  cached_at: string;
};

export type CachedSaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  created_at: string;
  products?: { name: string } | null;
};

export type CachedSale = {
  id: string;
  receipt_number: string;
  user_id: string;
  subtotal: number;
  tax: number;
  total_amount: number;
  sale_date: string;
  offline?: boolean;
  synced?: boolean;
  sale_items?: CachedSaleItem[];
};

export type CachedInventoryTxn = {
  id: string;
  product_id: string;
  transaction_type: string;
  quantity: number;
  reference: string | null;
  created_by: string | null;
  created_at: string;
  products?: { name: string } | null;
};

export type CachedUser = {
  id: string;
  full_name: string;
  username: string | null;
  email: string;
  roles: string[];
  created_at: string;
};

export type CachedSession = {
  userId: string;
  email: string;
  isAdmin: boolean;
  role: "admin" | "cashier";
  fullName: string;
  username: string;
  offlineMode?: boolean;
  cached_at: string;
};

export type CachedCredential = {
  email: string;
  password: string;
  userId: string;
  fullName: string;
  username: string;
  isAdmin: boolean;
  role: "admin" | "cashier";
  cached_at: string;
};

export type SaleItemInput = {
  product_id: string;
  quantity: number;
  unit_price: number;
};

export type PendingSale = {
  id: string;
  items: SaleItemInput[];
  tax_rate: number;
  subtotal: number;
  tax: number;
  total: number;
  receipt_number: string;
  created_at: string;
  status: "pending" | "syncing" | "failed";
  error?: string;
};

export type PendingMutationType =
  | "adjustInventory"
  | "upsertProduct"
  | "deleteProduct"
  | "upsertCategory"
  | "deleteCategory"
  | "updateUserRole"
  | "deleteUser"
  | "claimFirstAdmin";

export type PendingMutation = {
  id: string;
  type: PendingMutationType;
  payload: Record<string, unknown>;
  created_at: string;
  status: "pending" | "syncing" | "failed";
  error?: string;
};

export type CheckoutResult = {
  sale: { id: string; receipt_number: string };
  items: SaleItemInput[];
  subtotal: number;
  tax: number;
  total: number;
  offline: boolean;
};

export type DashboardStats = {
  totalSales: number;
  todaySales: number;
  totalProducts: number;
  totalStock: number;
  lowStockCount: number;
  lowStockItems: { id: string; name: string; stock_quantity: number; low_stock_threshold: number }[];
  recent: { id: string; receipt_number: string; total_amount: number; sale_date: string }[];
  best: { name: string; qty: number }[];
  salesChart: { date: string; total: number }[];
};
