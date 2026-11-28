/** Backup alerts via Telegram. Checks env credentials and Supabase Vault; never throws. */
const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';
const VAULT_CACHE_TTL_MS = 5 * 60 * 1000;

export type TelegramSendResult = {
  ok: boolean;
  chatId: string | null;
  error?: string;
};

type ResolvedTelegramConfig = {
  lovableKey: string | null;
  telegramKey: string | null;
  botToken: string | null;
  adminChatId: string | null;
  deliveryChatId: string | null;
};

type VaultTelegramSecrets = {
  botToken: string | null;
  adminChatId: string | null;
  deliveryChatId: string | null;
  fetchedAt: number;
};

let vaultCache: VaultTelegramSecrets | null = null;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function normalizeTelegramChatId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (!cleaned) return null;
  // Strip accidental invisible directional marks and "id:" prefix
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/^id\s*:\s*/i, '').trim();
  cleaned = cleaned.replace(/^https?:\/\/(www\.)?t\.me\//i, '@').replace(/^t\.me\//i, '@');
  // Remove accidental whitespace inside numeric IDs (e.g. "5123 456 789")
  if (/^-?[\d\s]+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\s+/g, '');
  }
  return cleaned || null;
}

function readEnvTelegramConfig(): ResolvedTelegramConfig {
  const lovableKey = process.env['LOVABLE_API_KEY']?.trim() || null;
  const telegramKey =
    process.env['TELEGRAM_API_KEY']?.trim() ||
    process.env['LOVABLE_CONNECTOR_TELEGRAM_API_KEY']?.trim() ||
    null;
  const botToken =
    process.env['TELEGRAM_BOT_TOKEN']?.trim() ||
    process.env['TELEGRAM_TOKEN']?.trim() ||
    process.env['LOVABLE_CONNECTOR_TELEGRAM_BOT_TOKEN']?.trim() ||
    null;
  const adminChatId = normalizeTelegramChatId(process.env['TELEGRAM_ADMIN_CHAT_ID']);
  const deliveryChatId = normalizeTelegramChatId(process.env['TELEGRAM_DELIVERY_CHAT_ID']);
  return { lovableKey, telegramKey, botToken, adminChatId, deliveryChatId };
}

export function hasTelegramCredentials(): boolean {
  const env = readEnvTelegramConfig();
  return Boolean((env.lovableKey && env.telegramKey) || env.botToken);
}

/**
 * Falls back to Supabase Vault (`vault.decrypted_secrets`, matching the DB
 * `telegram_send_alert` trigger) when server env vars are absent.
 */
async function readVaultTelegramSecrets(): Promise<VaultTelegramSecrets> {
  const now = Date.now();
  if (vaultCache && now - vaultCache.fetchedAt < VAULT_CACHE_TTL_MS) {
    return vaultCache;
  }
  const empty: VaultTelegramSecrets = {
    botToken: null,
    adminChatId: null,
    deliveryChatId: null,
    fetchedAt: now,
  };
  if (!process.env['SUPABASE_URL'] || !process.env['SUPABASE_SERVICE_ROLE_KEY']) {
    return empty;
  }
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const vaultClient = supabaseAdmin as unknown as {
      schema?: (name: string) => {
        from: (table: string) => {
          select: (cols: string) => {
            in: (
              col: string,
              vals: string[],
            ) => Promise<{
              data: Array<{ name?: string; decrypted_secret?: string }> | null;
              error: unknown;
            }>;
          };
        };
      };
    };
    if (typeof vaultClient.schema !== 'function') {
      vaultCache = empty;
      return empty;
    }
    const { data, error } = await vaultClient
      .schema('vault')
      .from('decrypted_secrets')
      .select('name, decrypted_secret')
      .in('name', ['telegram_bot_token', 'telegram_admin_chat_id', 'telegram_delivery_chat_id']);

    if (error || !Array.isArray(data)) {
      vaultCache = empty;
      return empty;
    }
    const byName = new Map(
      data
        .filter((r) => typeof r.name === 'string' && typeof r.decrypted_secret === 'string')
        .map((r) => [r.name as string, (r.decrypted_secret as string).trim()]),
    );
    const resolved: VaultTelegramSecrets = {
      botToken: byName.get('telegram_bot_token') || null,
      adminChatId: normalizeTelegramChatId(byName.get('telegram_admin_chat_id')),
      deliveryChatId: normalizeTelegramChatId(byName.get('telegram_delivery_chat_id')),
      fetchedAt: now,
    };
    vaultCache = resolved;
    return resolved;
  } catch {
    vaultCache = empty;
    return empty;
  }
}

async function resolveTelegramConfig(): Promise<ResolvedTelegramConfig> {
  const env = readEnvTelegramConfig();
  if ((env.lovableKey && env.telegramKey) || (env.botToken && env.adminChatId)) {
    return env;
  }
  const vault = await readVaultTelegramSecrets();
  return {
    lovableKey: env.lovableKey,
    telegramKey: env.telegramKey,
    botToken: env.botToken || vault.botToken,
    adminChatId: env.adminChatId || vault.adminChatId,
    deliveryChatId: env.deliveryChatId || vault.deliveryChatId,
  };
}

export async function hasAnyTelegramCredentials(): Promise<boolean> {
  if (hasTelegramCredentials()) return true;
  const resolved = await resolveTelegramConfig();
  return Boolean((resolved.lovableKey && resolved.telegramKey) || resolved.botToken);
}

export function parseTelegramError(
  status: number,
  bodyText: string,
  targetChatId?: string | null,
): string {
  try {
    const parsed = JSON.parse(bodyText) as { description?: string; error?: string };
    const desc = parsed.description || parsed.error;
    if (desc) {
      if (/chat not found/i.test(desc)) {
        if (targetChatId?.startsWith('@')) {
          return 'Telegram bots cannot message personal @usernames. Enter the rider’s numeric Chat ID (from @userinfobot) and ask them to tap /start on the bot.';
        }
        return 'Telegram chat not found — verify the numeric Chat ID and ensure the rider sent /start to the bot.';
      }
      if (/bot was blocked/i.test(desc)) {
        return 'Rider blocked the Telegram bot — ask them to unblock and send /start.';
      }
      if (/unauthorized/i.test(desc)) {
        return 'Telegram bot token is invalid or revoked. Update TELEGRAM_BOT_TOKEN in host secrets.';
      }
      return `Telegram [${status}]: ${desc}`;
    }
  } catch {
    // Non-JSON response
  }
  return `Telegram error [${status}]: ${bodyText.slice(0, 140)}`;
}

async function inspectTelegramResponse(
  res: Response,
  targetChatId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: parseTelegramError(res.status, text, targetChatId) };
  }
  if (text) {
    try {
      const parsed = JSON.parse(text) as { ok?: boolean; description?: string; error?: string };
      if (parsed && parsed.ok === false) {
        return { ok: false, error: parseTelegramError(res.status, text, targetChatId) };
      }
    } catch {
      // Non-JSON 200 response treated as accepted
    }
  }
  return { ok: true };
}

export async function sendTelegramDetailed(
  chatId: string | null | undefined,
  htmlText: string,
  allowAdminFallback = true,
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramSendResult> {
  const cfg = await resolveTelegramConfig();
  const normalized = normalizeTelegramChatId(chatId);
  const targetChatId = normalized || (allowAdminFallback ? cfg.adminChatId : null);
  if (!targetChatId) {
    return { ok: false, chatId: null, error: 'No Telegram Chat ID provided.' };
  }

  if (!(cfg.lovableKey && cfg.telegramKey) && !cfg.botToken) {
    return {
      ok: false,
      chatId: targetChatId,
      error: 'Telegram bot credentials are not configured on this host (set TELEGRAM_BOT_TOKEN).',
    };
  }

  let lastError: string | undefined;

  if (cfg.lovableKey && cfg.telegramKey) {
    try {
      const res = await fetchImpl(`${GATEWAY_URL}/sendMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.lovableKey}`,
          'X-Connection-Api-Key': cfg.telegramKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chat_id: targetChatId, text: htmlText, parse_mode: 'HTML' }),
      });
      const checked = await inspectTelegramResponse(res, targetChatId);
      if (checked.ok) {
        return { ok: true, chatId: targetChatId };
      }
      lastError = checked.error;
      console.error(`Telegram gateway alert failed [${res.status}]: ${checked.error}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Telegram gateway request failed';
      console.error('Telegram gateway alert failed', error);
    }
  }

  if (cfg.botToken) {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text: htmlText, parse_mode: 'HTML' }),
      });
      const checked = await inspectTelegramResponse(res, targetChatId);
      if (checked.ok) {
        return { ok: true, chatId: targetChatId };
      }
      lastError = checked.error;
      console.error(`Telegram bot alert failed [${res.status}]: ${checked.error}`);
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
  const cfg = await resolveTelegramConfig();
  if (!((cfg.lovableKey && cfg.telegramKey) || cfg.botToken) || !cfg.adminChatId) return false;
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
    return sendTelegramMessage(cfg.adminChatId, text);
  } catch (error) {
    console.error('Telegram alert failed', error);
    return false;
  }
}

/** Builds the HTML Telegram delivery assignment text respecting strict UPI/COD privacy rules. */
export function formatTelegramDeliveryBoyMessage(params: {
  boyName: string;
  orderId: string;
  customerName: string;
  deliveryAddress: string;
  phoneNumber?: string | null | undefined;
  items: { name: string; qty: number; price: number }[];
  paymentMethod: 'UPI' | 'COD';
  paidWithCoins: boolean;
  codCollectAmount: number | null;
}): string {
  const isPrepaid = params.paymentMethod === 'UPI' || params.paidWithCoins;
  const itemLines =
    params.items.length > 0
      ? params.items
          .map((i) =>
            isPrepaid
              ? `  • ${i.qty}x ${esc(i.name)}`
              : `  • ${i.qty}x ${esc(i.name)} — ₹${Number(i.price).toFixed(0)}`,
          )
          .join('\n')
      : '  • See items in Delivery Partner tab';

  const lines = [
    `🛵 <b>Delivery Assigned to ${esc(params.boyName)} (#${params.orderId.slice(0, 8).toUpperCase()})</b>`,
    `📍 Address: ${esc(params.deliveryAddress)}`,
    `👤 Customer: ${esc(params.customerName)}`,
    params.phoneNumber ? `📞 ${esc(params.phoneNumber)}` : '',
    `📦 Items:\n${itemLines}`,
    isPrepaid
      ? `💳 Payment: <b>${params.paidWithCoins ? 'Campu Coins / UPI Prepaid' : 'UPI Prepaid'} (Do NOT collect cash)</b>`
      : `💵 Cash on Delivery — <b>Collect Total: ₹${Number(params.codCollectAmount ?? 0).toFixed(0)}</b>`,
    `Ask customer for 4-digit OTP to complete delivery.`,
  ].filter(Boolean);

  return lines.join('\n');
}

/** Sends a Delivery Boy assignment alert respecting strict UPI/COD privacy rules. */
export async function sendTelegramDeliveryBoyAlert(
  params: {
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
  },
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramSendResult> {
  const cfg = await resolveTelegramConfig();
  const explicitBoyChat = normalizeTelegramChatId(params.boyChatId);
  const fallbackChat = cfg.deliveryChatId || cfg.adminChatId;
  const targetChat = explicitBoyChat || fallbackChat;
  if (!targetChat) {
    return { ok: false, chatId: null, error: 'No Delivery Boy or Admin Telegram Chat ID configured.' };
  }

  const message = formatTelegramDeliveryBoyMessage(params);
  return sendTelegramDetailed(targetChat, message, !explicitBoyChat, fetchImpl);
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
  const cfg = await resolveTelegramConfig();
  const adminChat = cfg.adminChatId;
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
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramSendResult> {
  const label = boyName?.trim() ? esc(boyName.trim()) : 'Delivery Partner';
  const html = `✅ <b>Campu Delivery Telegram Test</b>\nHello ${label}! Your Telegram Chat ID is connected and ready for delivery order alerts.`;
  return sendTelegramDetailed(chatId, html, false, fetchImpl);
}
