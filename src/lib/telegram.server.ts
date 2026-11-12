/** Backup admin alert via Telegram. Skips silently when not configured; never throws. */
const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendTelegramOrderAlert(orderId: string): Promise<boolean> {
  const lovableKey = process.env['LOVABLE_API_KEY'];
  const telegramKey = process.env['TELEGRAM_API_KEY'];
  const chatId = process.env['TELEGRAM_ADMIN_CHAT_ID'];
  if (!lovableKey || !telegramKey || !chatId) return false;
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: order } = await supabaseAdmin.from('orders')
      .select('id,total,cart_items,payment_method,delivery_address,phone_number,student_id')
      .eq('id', orderId).maybeSingle();
    if (!order) return false;
    const { data: profile } = await supabaseAdmin.from('profiles').select('full_name').eq('id', order.student_id).maybeSingle();
    const items = (Array.isArray(order.cart_items) ? order.cart_items : []) as { name?: string; qty?: number }[];
    const text = [
      `🚀 <b>New Order #${order.id.slice(0, 8).toUpperCase()} - ₹${Number(order.total).toFixed(0)}</b>`,
      `👤 Student: ${esc(profile?.full_name ?? 'Student')} (${esc(order.delivery_address ?? '-')})`,
      order.phone_number ? `📞 ${esc(order.phone_number)}` : '',
      `📦 Items: ${esc(items.map((i) => `${i.qty ?? 1}x ${i.name ?? 'Item'}`).join(', '))}`,
      `💳 Payment: ${esc(order.payment_method)}`,
    ].filter(Boolean).join('\n');
    const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': telegramKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) {
      console.error(`Telegram alert failed [${res.status}]: ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Telegram alert failed', error);
    return false;
  }
}
