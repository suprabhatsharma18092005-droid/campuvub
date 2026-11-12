-- lovable-cron-fallback-reviewed: Telegram outages need guaranteed redelivery within ~1 minute; job is a cheap no-op when queue is empty.
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE public.telegram_alert_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  request_id bigint,
  last_error text,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.telegram_alert_queue TO service_role;
ALTER TABLE public.telegram_alert_queue ENABLE ROW LEVEL SECURITY;
CREATE INDEX telegram_alert_queue_pending_idx ON public.telegram_alert_queue (status) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.telegram_send_alert(_queue_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.telegram_alert_queue;
  o public.orders;
  bot text; chat text; who text; items text; msg text; rid bigint;
BEGIN
  SELECT * INTO q FROM public.telegram_alert_queue WHERE id = _queue_id;
  IF NOT FOUND OR q.status <> 'pending' THEN RETURN; END IF;
  SELECT decrypted_secret INTO bot FROM vault.decrypted_secrets WHERE name = 'telegram_bot_token' LIMIT 1;
  SELECT decrypted_secret INTO chat FROM vault.decrypted_secrets WHERE name = 'telegram_admin_chat_id' LIMIT 1;
  IF bot IS NULL OR chat IS NULL THEN
    UPDATE public.telegram_alert_queue SET last_error = 'Telegram not configured', last_attempt_at = now() WHERE id = _queue_id;
    RETURN;
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = q.order_id;
  SELECT full_name INTO who FROM public.profiles WHERE id = o.student_id;
  SELECT string_agg(COALESCE(i->>'qty','1') || 'x ' || COALESCE(i->>'name','Item') || ' @ ₹' || COALESCE(i->>'price','?'), E'\n  ')
    INTO items FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.cart_items) = 'array' THEN o.cart_items ELSE '[]'::jsonb END) i;
  msg := '🚀 New Order #' || upper(left(o.id::text, 8)) || ' - ₹' || round(o.total)::text || E'\n'
    || '👤 ' || COALESCE(who, 'Student') || ' (' || COALESCE(o.delivery_address, '-') || ')' || E'\n'
    || CASE WHEN o.phone_number IS NOT NULL THEN '📞 ' || o.phone_number || E'\n' ELSE '' END
    || '📦 Items:' || E'\n  ' || COALESCE(items, '-') || E'\n'
    || '💳 Payment: ' || o.payment_method::text;
  SELECT net.http_post(
    url := 'https://api.telegram.org/bot' || bot || '/sendMessage',
    body := jsonb_build_object('chat_id', chat, 'text', msg),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 10000
  ) INTO rid;
  UPDATE public.telegram_alert_queue
    SET request_id = rid, attempts = attempts + 1, last_attempt_at = now(), last_error = NULL
    WHERE id = _queue_id;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_telegram_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE qid uuid;
BEGIN
  BEGIN
    INSERT INTO public.telegram_alert_queue (order_id) VALUES (NEW.id) RETURNING id INTO qid;
    PERFORM public.telegram_send_alert(qid);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Telegram alert enqueue failed: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

CREATE TRIGGER enqueue_telegram_alert AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_telegram_alert();

CREATE OR REPLACE FUNCTION public.telegram_retry_alerts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q record; r record;
BEGIN
  FOR q IN SELECT * FROM public.telegram_alert_queue WHERE status = 'pending' ORDER BY created_at LIMIT 50 LOOP
    BEGIN
      IF q.created_at < now() - interval '24 hours' OR q.attempts >= 100 THEN
        UPDATE public.telegram_alert_queue SET status = 'failed' WHERE id = q.id;
        CONTINUE;
      END IF;
      r := NULL;
      IF q.request_id IS NOT NULL THEN
        SELECT status_code, timed_out, error_msg, left(content, 200) AS content INTO r FROM net._http_response WHERE id = q.request_id;
      END IF;
      IF r IS NOT NULL AND r.status_code = 200 THEN
        UPDATE public.telegram_alert_queue SET status = 'delivered', delivered_at = now() WHERE id = q.id;
      ELSIF r IS NOT NULL OR q.request_id IS NULL OR q.last_attempt_at < now() - interval '2 minutes' THEN
        UPDATE public.telegram_alert_queue
          SET last_error = COALESCE(r.status_code::text || ' ' || COALESCE(r.content, r.error_msg, ''), last_error)
          WHERE id = q.id;
        PERFORM public.telegram_send_alert(q.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.telegram_alert_queue SET last_error = SQLERRM WHERE id = q.id;
    END;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.telegram_send_alert(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_retry_alerts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_telegram_alert() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('telegram-alert-retry', '* * * * *', $$SELECT public.telegram_retry_alerts();$$);