export const clampInventoryValue = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export const applyIngredientStockIn = (item: any, quantity: number) => {
  const qty = clampInventoryValue(quantity);
  const initialStock = clampInventoryValue(item?.initial_stock ?? 0) + qty;
  const addedStock = clampInventoryValue(item?.added_stock ?? 0) + qty;
  const usedStock = clampInventoryValue(item?.total_used ?? 0);
  const remainingStock = clampInventoryValue(item?.current_stock ?? 0) + qty;

  return {
    initial_stock: initialStock,
    added_stock: addedStock,
    total_used: usedStock,
    current_stock: remainingStock,
  };
};

export const applyIngredientStockOut = (item: any, quantity: number) => {
  const qty = clampInventoryValue(quantity);
  const currentStock = clampInventoryValue(item?.current_stock ?? 0) - qty;
  const usedStock = clampInventoryValue(item?.total_used ?? 0) + qty;

  if (currentStock < 0) {
    throw new Error("Resulting stock cannot be negative");
  }

  return {
    initial_stock: clampInventoryValue(item?.initial_stock ?? 0),
    added_stock: clampInventoryValue(item?.added_stock ?? 0),
    total_used: usedStock,
    current_stock: currentStock,
  };
};

export const applyIngredientSale = (item: any, quantity: number) => {
  const qty = clampInventoryValue(quantity);
  const usedStock = clampInventoryValue(item?.total_used ?? 0) + qty;
  const remainingStock = clampInventoryValue(item?.current_stock ?? 0) - qty;

  if (remainingStock < 0) {
    throw new Error("Resulting stock cannot be negative");
  }

  return {
    initial_stock: clampInventoryValue(item?.initial_stock ?? 0),
    added_stock: clampInventoryValue(item?.added_stock ?? 0),
    total_used: usedStock,
    current_stock: remainingStock,
  };
};
