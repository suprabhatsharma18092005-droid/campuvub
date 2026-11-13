CREATE TABLE public.vip_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 149,
  utr_number text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  starts_at timestamptz,
  expires_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vip_subscriptions_user_idx ON public.vip_subscriptions(user_id, expires_at DESC);
CREATE UNIQUE INDEX vip_subscriptions_utr_idx ON public.vip_subscriptions(utr_number);
GRANT SELECT, INSERT, UPDATE ON public.vip_subscriptions TO authenticated;
GRANT ALL ON public.vip_subscriptions TO service_role;
ALTER TABLE public.vip_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own VIP, admins read all" ON public.vip_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users request own VIP" ON public.vip_subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins review VIP" ON public.vip_subscriptions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.guard_vip_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT (auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin')) THEN
      IF NEW.utr_number IS NULL OR NEW.utr_number !~ '^[0-9]{12}$' THEN
        RAISE EXCEPTION 'Enter the 12-digit UPI transaction ID.';
      END IF;
      IF EXISTS (SELECT 1 FROM public.vip_subscriptions WHERE user_id = NEW.user_id AND status = 'pending') THEN
        RAISE EXCEPTION 'Your VIP request is already waiting for approval.';
      END IF;
      NEW.status := 'pending'; NEW.starts_at := NULL; NEW.expires_at := NULL; NEW.reviewed_at := NULL;
      NEW.amount := COALESCE((SELECT value::numeric FROM public.app_settings WHERE key = 'vip_price' AND value ~ '^[0-9]+(\.[0-9]+)?$'), 149);
    END IF;
    NEW.created_at := now();
  ELSE
    IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
      SELECT max(expires_at) INTO base FROM public.vip_subscriptions
        WHERE user_id = NEW.user_id AND status = 'approved' AND expires_at > now() AND id <> NEW.id;
      NEW.starts_at := COALESCE(base, now());
      NEW.expires_at := NEW.starts_at + interval '30 days';
      NEW.reviewed_at := now();
    ELSIF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
      NEW.reviewed_at := now(); NEW.starts_at := NULL; NEW.expires_at := NULL;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER guard_vip_subscription BEFORE INSERT OR UPDATE ON public.vip_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_vip_subscription();

CREATE OR REPLACE FUNCTION public.is_vip(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.vip_subscriptions
    WHERE user_id = _user_id AND status = 'approved' AND starts_at <= now() AND expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.vip_free_quick_used_today(_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.orders
  WHERE student_id = _user_id AND delivery_type = 'quick' AND delivery_fee = 0 AND status <> 'cancelled'
    AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
$$;

CREATE OR REPLACE FUNCTION public.enforce_scheduled_order_fee()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE expected numeric; vip boolean;
BEGIN
  IF NEW.delivery_type = 'sunday_tuesday' THEN
    IF NEW.subtotal < 99 THEN
      RAISE EXCEPTION 'Minimum order is ₹99 for Sunday & Tuesday Special.';
    END IF;
    vip := public.is_vip(NEW.student_id);
    expected := CASE WHEN vip THEN (CASE WHEN NEW.subtotal >= 300 THEN 0 ELSE 3 END)
                     ELSE (CASE WHEN NEW.subtotal >= 300 THEN 10 ELSE 15 END) END;
    IF NEW.delivery_fee <> expected OR NEW.total <> NEW.subtotal + expected THEN
      RAISE EXCEPTION 'Delivery fee does not match Sunday & Tuesday Special pricing.';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.validate_new_order()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  night boolean;
  raw text;
  expected numeric;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.student_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only place orders for yourself.';
  END IF;
  IF NEW.delivery_type NOT IN ('quick', 'sunday_tuesday') THEN
    RAISE EXCEPTION 'Unknown delivery type.';
  END IF;
  IF NEW.payment_method = 'UPI' THEN
    IF NEW.status <> 'payment_review' THEN RAISE EXCEPTION 'Invalid order status.'; END IF;
    IF NEW.utr_number IS NULL OR NEW.utr_number !~ '^[0-9]{12}$' THEN
      RAISE EXCEPTION 'Enter the 12-digit UPI transaction ID.';
    END IF;
  ELSE
    IF NEW.status <> 'pending' THEN RAISE EXCEPTION 'Invalid order status.'; END IF;
  END IF;

  SELECT value = 'true' INTO night FROM public.app_settings WHERE key = 'night_mode_enabled';
  night := COALESCE(night, false);
  IF night AND NEW.payment_method = 'COD' THEN
    RAISE EXCEPTION 'Cash on delivery is unavailable during night mode.';
  END IF;

  IF NEW.total <> NEW.subtotal + NEW.delivery_fee THEN
    RAISE EXCEPTION 'Order total does not match.';
  END IF;

  IF NEW.delivery_type = 'quick' THEN
    IF NEW.subtotal >= 99 AND public.is_vip(NEW.student_id)
       AND public.vip_free_quick_used_today(NEW.student_id) < 2 THEN
      expected := 0;
    ELSE
      SELECT value INTO raw FROM public.app_settings
        WHERE key = CASE WHEN NEW.payment_method = 'COD' THEN 'cod_delivery_charge'
                         WHEN night THEN 'night_upi_delivery_charge'
                         ELSE 'upi_delivery_charge' END;
      expected := CASE WHEN raw ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN raw::numeric
                       WHEN NEW.payment_method = 'COD' THEN 8 ELSE 5 END;
    END IF;
    IF NEW.delivery_fee <> expected THEN
      RAISE EXCEPTION 'Delivery fee changed. Review your total before ordering.';
    END IF;
  END IF;

  NEW.accepted_at := NULL;
  NEW.cancelled_at := NULL;
  NEW.cancellation_fee := 0;
  NEW.refund_status := 'none';
  NEW.refund_proof_url := NULL;
  NEW.refunded_at := NULL;
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

INSERT INTO public.app_settings (key, value) VALUES ('vip_price', '149') ON CONFLICT (key) DO NOTHING;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vip_subscriptions;