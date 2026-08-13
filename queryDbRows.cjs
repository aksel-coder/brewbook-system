const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.error('.env not found');
  process.exit(1);
}
const env = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean).reduce((acc, line) => {
  if (line.startsWith('#')) return acc;
  const idx = line.indexOf('=');
  if (idx < 0) return acc;
  acc[line.slice(0, idx)] = line.slice(idx + 1);
  return acc;
}, {});
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(url, key);
(async () => {
  console.log('SUPABASE_URL=', url);
  const [products, categories, sales, saleItems, inv] = await Promise.all([
    supabase.from('products').select('id, name, category_id, price, stock_quantity, image_url, updated_at').order('name'),
    supabase.from('categories').select('id, name').order('name'),
    supabase.from('sales').select('id, receipt_number, total_amount, sale_date').order('sale_date', { ascending: false }).limit(10),
    supabase.from('sale_items').select('id, sale_id, product_id, quantity, unit_price').limit(10),
    supabase.from('inventory_transactions').select('id, product_id, transaction_type, quantity, created_at').order('created_at', { ascending: false }).limit(10),
  ]);
  for (const [name, res] of [['products', products], ['categories', categories], ['sales', sales], ['sale_items', saleItems], ['inventory_transactions', inv]]) {
    if (res.error) {
      console.error(name.toUpperCase(), 'ERROR', res.error.message);
    } else {
      console.log(name.toUpperCase(), 'COUNT', res.data?.length ?? 0);
      console.log(JSON.stringify(res.data, null, 2));
    }
  }
  const counts = {};
  for (const table of ['products', 'categories', 'sales', 'sale_items', 'inventory_transactions']) {
    const res = await supabase.from(table).select('id', { head: true, count: 'exact' });
    counts[table] = res.error ? res.error.message : res.count;
  }
  console.log('COUNTS', JSON.stringify(counts, null, 2));
})();
