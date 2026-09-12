import assert from 'node:assert/strict';
import { getLowStockInventory } from './low-stock.ts';

const products = [
  { id: 'p-fg', name: 'Espresso', stock_quantity: 5, low_stock_threshold: 10 },
  { id: 'p-rb', name: 'Latte', stock_quantity: 2, low_stock_threshold: 5, categories: { category_type: 'recipe_based' } },
  { id: 'p-unknown', name: 'Cake', stock_quantity: 2, low_stock_threshold: 5 },
];
const inventoryItems = [
  { id: 'i-1', name: 'Coffee Beans', current_stock: 12, low_stock_threshold: 15 },
  { id: 'i-2', name: 'Milk', current_stock: 3, low_stock_threshold: 5 },
  { id: 'i-3', name: 'Ice', current_stock: 0, low_stock_threshold: 0 },
];

const result = getLowStockInventory({ products, inventoryItems, recipesByProduct: new Map([['p-rb', [{ product_id: 'p-rb' }]]]) });

assert.deepEqual(result.map((item) => item.name).sort(), ['Cake', 'Coffee Beans', 'Espresso', 'Ice', 'Milk']);
assert.equal(result.filter((item) => item.name === 'Latte').length, 0);
assert.equal(result.filter((item) => item.name === 'Cake').length, 1);
console.log('Low-stock rules test passed');
