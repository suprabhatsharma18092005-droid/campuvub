/** Backup alerts via Telegram. Skips silently when not configured; never throws. */
const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

export type TelegramSendResult = {
  ok: boolean;
  chatId: string | null;
  error?: string;
};

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function normalizeTelegramChatId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (!cleaned) return null;
  cleaned = cleaned.replace(/^https?:\/\/(www\.)?t\.me\//i, '@').replace(/^t\.me\//i, '@');
  // Strip accidental surrounding whitespace or invisible directional marks
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  return cleaned || null;
}

export function hasTelegramCredentials(): boolean {
  const lovableKey = process.env['LOVABLE_API_KEY']?.trim();
  const telegramKey = process.env['TELEGRAM_API_KEY']?.trim();
  const botToken = process.env['TELEGRAM_BOT_TOKEN']?.trim();
  return Boolean((lovableKey && telegramKey) || botToken);
}

function parseTelegramError(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { description?: string; error?: string };
    const desc = parsed.description || parsed.error;
    if (desc) {
      if (/chat not found/i.test(desc)) {
        return 'Telegram chat not found — check Chat ID and ensure rider clicked /start on the bot.';
      }
      if (/bot was blocked/i.test(desc)) {
        return 'Rider blocked the Telegram bot — ask them to unblock and send /start.';
      }
      return `Telegram [${status}]: ${desc}`;
    }
  } catch {
    // Non-JSON response
  }
  return `Telegram error [${status}]: ${bodyText.slice(0, 140)}`;
}

export async function sendTelegramDetailed(
  chatId: string | null | undefined,
  htmlText: string,
  allowAdminFallback = true,
): Promise<TelegramSendResult> {
  const normalized = normalizeTelegramChatId(chatId);
  const targetChatId =
    normalized ||
    (allowAdminFallback ? normalizeTelegramChatId(process.env['TELEGRAM_ADMIN_CHAT_ID']) : null);
  if (!targetChatId) {
    return { ok: false, chatId: null, error: 'No Telegram Chat ID provided.' };
  }

  const lovableKey = process.env['LOVABLE_API_KEY']?.trim();
  const telegramKey = process.env['TELEGRAM_API_KEY']?.trim();
  const botToken = process.env['TELEGRAM_BOT_TOKEN']?.trim();

  if (!(lovableKey && telegramKey) && !botToken) {
    return {
      ok: false,
      chatId: targetChatId,
      error: 'Telegram bot credentials are not configured on this host.',
    };
  }

  let lastError: string | undefined;

  if (lovableKey && telegramKey) {
    try {
      const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          'X-Connection-Api-Key': telegramKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chat_id: targetChatId, text: htmlText, parse_mode: 'HTML' }),
      });
      if (res.ok) {
        return { ok: true, chatId: targetChatId };
      }
      const errText = await res.text();
      lastError = parseTelegramError(res.status, errText);
      console.error(`Telegram gateway alert failed [${res.status}]: ${errText.slice(0, 200)}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Telegram gateway request failed';
      console.error('Telegram gateway alert failed', error);
    }
  }

  if (botToken) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text: htmlText, parse_mode: 'HTML' }),
      });
      if (res.ok) {
        return { ok: true, chatId: targetChatId };
      }
      const errText = await res.text();
      lastError = parseTelegramError(res.status, errText);
      console.error(`Telegram bot alert failed [${res.status}]: ${errText.slice(0, 200)}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Telegram Bot API request failed';
      console.error('Telegram bot alert failed', error);
    }
  }

  return {
    ok: false,
    chatId: targetChatId,
    error: lastError ?? 'Telegram send failed.',
  };
}

async function sendTelegramMessage(chatId: string | null | undefined, htmlText: string): Promise<boolean> {
  const res = await sendTelegramDetailed(chatId, htmlText, true);
  return res.ok;
}

export async function sendTelegramOrderAlert(orderId: string): Promise<boolean> {
  const chatId = process.env['TELEGRAM_ADMIN_CHAT_ID'];
  if (!hasTelegramCredentials() || !chatId) return false;
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
    return sendTelegramMessage(chatId, text);
  } catch (error) {
    console.error('Telegram alert failed', error);
    return false;
  }
}

/** Sends a Delivery Boy assignment alert respecting strict UPI/COD privacy rules. */
export async function sendTelegramDeliveryBoyAlert(params: {
  boyName: string;
  boyChatId?: string | null | undefined;
  orderId: string;
  customerName: string;
  deliveryAddress: string;
  phoneNumber?: string | null | undefined;
  items: { name: string; qty: number; price: number }[];
  paymentMethod: 'UPI' | 'COD';
  paidWithCoins: boolean;
  codCollectAmount: number | null;
}): Promise<TelegramSendResult> {
  const explicitBoyChat = normalizeTelegramChatId(params.boyChatId);
  const fallbackChat =
    normalizeTelegramChatId(process.env['TELEGRAM_DELIVERY_CHAT_ID']) ||
    normalizeTelegramChatId(process.env['TELEGRAM_ADMIN_CHAT_ID']);
  const targetChat = explicitBoyChat || fallbackChat;
  if (!targetChat) {
    return { ok: false, chatId: null, error: 'No Delivery Boy or Admin Telegram Chat ID configured.' };
  }

  const isPrepaid = params.paymentMethod === 'UPI' || params.paidWithCoins;
  const itemLines = params.items
    .map((i) => `  • ${i.qty}x ${esc(i.name)} — ₹${Number(i.price).toFixed(0)}`)
    .join('\n');

  const lines = [
    `🛵 <b>Delivery Assigned to ${esc(params.boyName)} (#${params.orderId.slice(0, 8).toUpperCase()})</b>`,
    `📍 Address: ${esc(params.deliveryAddress)}`,
    `👤 Customer: ${esc(params.customerName)}`,
    params.phoneNumber ? `📞 ${esc(params.phoneNumber)}` : '',
    `📦 Items:\n${itemLines}`,
    isPrepaid
      ? `💳 Payment: <b>UPI Prepaid (Do NOT collect cash)</b>`
      : `💵 Cash on Delivery — <b>Collect Total: ₹${Number(params.codCollectAmount ?? 0).toFixed(0)}</b>`,
    `Ask customer for 4-digit OTP to complete delivery.`,
  ].filter(Boolean);

  return sendTelegramDetailed(targetChat, lines.join('\n'), !explicitBoyChat);
}

/** Sends a Delivery Boy Payout Request alert to Admin's Telegram. */
export async function sendTelegramPayoutAlert(params: {
  boyName: string;
  phone?: string | null | undefined;
  amount: number;
  method: 'UPI' | 'COD';
  upiId?: string | null | undefined;
  bankingName?: string | null | undefined;
}): Promise<TelegramSendResult> {
  const adminChat = normalizeTelegramChatId(process.env['TELEGRAM_ADMIN_CHAT_ID']);
  if (!adminChat) {
    return { ok: false, chatId: null, error: 'TELEGRAM_ADMIN_CHAT_ID not configured.' };
  }

  const lines = [
    `💸 <b>Delivery Boy Payout Request — ₹${Number(params.amount).toFixed(2)}</b>`,
    `🛵 Rider: ${esc(params.boyName)}${params.phone ? ` (${esc(params.phone)})` : ''}`,
    params.method === 'UPI'
      ? `💳 Method: <b>UPI</b>\n🏦 Banking Name: ${esc(params.bankingName ?? '-')}\n🔗 UPI ID: <code>${esc(params.upiId ?? '-')}</code>`
      : `💵 Method: <b>Cash on Delivery (Cash Handover)</b>`,
    `Review in Admin → Delivery Boys`,
  ];

  return sendTelegramDetailed(adminChat, lines.join('\n'), false);
}

/** Sends a test message to verify a Delivery Boy's Telegram Chat ID. */
export async function sendTelegramTestAlert(
  chatId: string,
  boyName?: string | null,
): Promise<TelegramSendResult> {
  const label = boyName?.trim() ? esc(boyName.trim()) : 'Delivery Partner';
  const html = `✅ <b>Campu Delivery Telegram Test</b>\nHello ${label}! Your Telegram Chat ID is connected and ready for delivery order alerts.`;
  return sendTelegramDetailed(chatId, html, false);
}
