const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const file = path.join(process.cwd(), '.env');
if (!fs.existsSync(file)) {
  console.error('.env missing');
  process.exit(1);
}
const env = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).reduce((a, line) => {
  if (line.startsWith('#')) return a;
  const idx = line.indexOf('=');
  if (idx < 0) return a;
  a[line.slice(0, idx)] = line.slice(idx + 1);
  return a;
}, {});
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing env', { SUPABASE_URL: !!url, SUPABASE_SERVICE_ROLE_KEY: !!key });
  process.exit(1);
}
const supabase = createClient(url, key);
(async () => {
  const tables = ['products', 'categories', 'sales', 'sale_items', 'inventory_transactions'];
  for (const t of tables) {
    const r = await supabase.from(t).select('id,name,product_id,sale_id,total_amount').limit(20);
    console.log('TABLE', t, JSON.stringify({ error: r.error?.message, data: r.data, count: r.count }, null, 2));
  }
  const counts = {};
  for (const t of tables) {
    const r = await supabase.from(t).select('id', { head: true, count: 'exact' });
    counts[t] = r.error ? r.error.message : r.count;
  }
  console.log('COUNTS', JSON.stringify(counts, null, 2));
  const rev = await supabase.from('sales').select('total_amount');
  console.log('REV', rev.error ? rev.error.message : (rev.data || []).reduce((a, r) => a + Number(r.total_amount || 0), 0));
})();
