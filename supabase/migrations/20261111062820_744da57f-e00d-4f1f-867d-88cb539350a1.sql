-- ===== Enums =====
CREATE TYPE public.app_role AS ENUM ('student', 'vendor', 'admin');
CREATE TYPE public.order_status AS ENUM ('pending', 'payment_review', 'accepted', 'out_for_delivery', 'delivered', 'cancelled');
CREATE TYPE public.payment_method AS ENUM ('UPI', 'COD');

-- ===== Profiles =====
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone_number text,
  hostel_details text,
  room_number text,
  ban_status text,
  fcm_token text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.profiles.fcm_token IS 'Legacy single-device token; new push delivery uses public.push_devices with explicit Firebase project and per-device registration.';

-- ===== Roles =====
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users read own profile, admins read all" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users create own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ===== App settings =====
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
GRANT SELECT ON public.app_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads settings" ON public.app_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins insert settings" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update settings" ON public.app_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete settings" ON public.app_settings FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ===== Banners =====
CREATE TABLE public.banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_path text NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.banners TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banners TO authenticated;
GRANT ALL ON public.banners TO service_role;
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads active banners" ON public.banners FOR SELECT TO anon, authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert banners" ON public.banners FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update banners" ON public.banners FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete banners" ON public.banners FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ===== Broadcasts =====
CREATE TABLE public.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.broadcasts TO anon;
GRANT SELECT, INSERT, DELETE ON public.broadcasts TO authenticated;
GRANT ALL ON public.broadcasts TO service_role;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads broadcasts" ON public.broadcasts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins send broadcasts" ON public.broadcasts FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete broadcasts" ON public.broadcasts FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ===== Categories =====
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  emoji text NOT NULL DEFAULT '🛍️',
  image_url text,
  sort_order integer NOT NULL DEFAULT 0
);
GRANT SELECT ON public.categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads categories" ON public.categories FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins insert categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update categories" ON public.categories FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete categories" ON public.categories FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ===== Products =====
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  price numeric NOT NULL,
  actual_price numeric,
  badge_text text,
  specs_text text,
  tagline text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  image_url text,
  image_path text,
  in_stock boolean NOT NULL DEFAULT true,
  stock_quantity integer NOT NULL DEFAULT 0,
  delivery_types text[] NOT NULL DEFAULT ARRAY['quick']::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category_id_idx ON public.products(category_id);
GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads products" ON public.products FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update products" ON public.products FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete products" ON public.products FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ===== Orders =====
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  cart_items jsonb NOT NULL,
  subtotal numeric NOT NULL DEFAULT 0,
  delivery_fee numeric NOT NULL,
  total numeric NOT NULL DEFAULT 0,
  payment_method public.payment_method NOT NULL,
  utr_number text,
  status public.order_status NOT NULL DEFAULT 'pending',
  delivery_address text,
  phone_number text,
  delivery_otp text,
  delivery_type text NOT NULL DEFAULT 'quick',
  delivery_date date,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  cancellation_fee numeric NOT NULL DEFAULT 0,
  refund_status text NOT NULL DEFAULT 'none',
  refund_proof_url text,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_student_id_idx ON public.orders(student_id);
CREATE INDEX orders_created_at_idx ON public.orders(created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students read own orders, admins read all" ON public.orders FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Students place own orders" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());
CREATE POLICY "Students update own orders, admins update all" ON public.orders FOR UPDATE TO authenticated
  USING (student_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (student_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Order placement rules (non-admin callers)
CREATE OR REPLACE FUNCTION public.validate_new_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    SELECT value INTO raw FROM public.app_settings
      WHERE key = CASE WHEN NEW.payment_method = 'COD' THEN 'cod_delivery_charge'
                       WHEN night THEN 'night_upi_delivery_charge'
                       ELSE 'upi_delivery_charge' END;
    expected := CASE WHEN raw ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN raw::numeric
                     WHEN NEW.payment_method = 'COD' THEN 8 ELSE 5 END;
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
END $$;
CREATE TRIGGER validate_new_order BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.validate_new_order();

-- Sunday & Tuesday Special minimum order and fee slabs
CREATE OR REPLACE FUNCTION public.enforce_scheduled_order_fee()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE expected numeric;
BEGIN
  IF NEW.delivery_type = 'sunday_tuesday' THEN
    IF NEW.subtotal < 99 THEN
      RAISE EXCEPTION 'Minimum order is ₹99 for Sunday & Tuesday Special.';
    END IF;
    expected := CASE WHEN NEW.subtotal >= 500 THEN 1 WHEN NEW.subtotal >= 300 THEN 5 WHEN NEW.subtotal >= 200 THEN 12 ELSE 15 END;
    IF NEW.delivery_fee <> expected OR NEW.total <> NEW.subtotal + expected THEN
      RAISE EXCEPTION 'Delivery fee does not match Sunday & Tuesday Special pricing.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enforce_scheduled_order_fee BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_scheduled_order_fee();

-- Order update rules: timestamps, OTP-only delivery, student cancellation window
CREATE OR REPLACE FUNCTION public.guard_order_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_admin boolean := auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin');
  editable text[] := ARRAY['status', 'cancelled_at', 'cancellation_fee', 'refund_status', 'updated_at'];
BEGIN
  IF NOT is_admin THEN
    IF OLD.student_id <> auth.uid() THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
    IF (to_jsonb(NEW) - editable) IS DISTINCT FROM (to_jsonb(OLD) - editable) THEN
      RAISE EXCEPTION 'You can only cancel this order.';
    END IF;
    IF NEW.status <> 'cancelled' OR OLD.status <> 'accepted' OR OLD.accepted_at IS NULL
       OR now() - OLD.accepted_at > interval '3 minutes 20 seconds' THEN
      RAISE EXCEPTION 'The cancellation window has closed.';
    END IF;
    NEW.cancelled_at := now();
    NEW.cancellation_fee := 0;
    NEW.refund_status := CASE WHEN OLD.payment_method = 'UPI' THEN 'pending' ELSE 'none' END;
  END IF;

  IF NEW.status = 'delivered' AND OLD.status <> 'delivered'
     AND COALESCE(current_setting('campu.otp_verified', true), '') <> 'true' THEN
    RAISE EXCEPTION 'Delivery code required';
  END IF;
  IF NEW.status = 'accepted' AND OLD.status <> 'accepted' AND NEW.accepted_at IS NULL THEN
    NEW.accepted_at := now();
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER guard_order_update BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_update();

CREATE OR REPLACE FUNCTION public.deliver_order_with_otp(_order_id uuid, _delivery_otp text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_otp text;
  current_status public.order_status;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT delivery_otp, status INTO current_otp, current_status FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF current_status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'This order is already closed.';
  END IF;
  IF current_otp IS NULL OR trim(COALESCE(_delivery_otp, '')) <> current_otp THEN
    RAISE EXCEPTION 'Incorrect delivery code';
  END IF;
  PERFORM set_config('campu.otp_verified', 'true', true);
  UPDATE public.orders SET status = 'delivered' WHERE id = _order_id;
  PERFORM set_config('campu.otp_verified', '', true);
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.deliver_order_with_otp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deliver_order_with_otp(uuid, text) TO authenticated, service_role;

-- ===== Suggestions =====
CREATE TABLE public.suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text,
  suggestion_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.suggestions TO authenticated;
GRANT ALL ON public.suggestions TO service_role;
ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own suggestions, admins read all" ON public.suggestions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users send own suggestions" ON public.suggestions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins delete suggestions" ON public.suggestions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ===== Push devices =====
CREATE TABLE public.push_devices (
  token text PRIMARY KEY CHECK (length(token) BETWEEN 10 AND 500),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  project_id text NOT NULL CHECK (project_id = 'puch-campu'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO authenticated;
GRANT ALL ON public.push_devices TO service_role;
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_devices_own ON public.push_devices FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX push_devices_user_id_idx ON public.push_devices(user_id);

CREATE OR REPLACE FUNCTION public.register_push_device(_token text, _device_id uuid, _project_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF _token IS NULL OR length(_token) < 10 OR length(_token) > 500 THEN
    RAISE EXCEPTION 'Invalid notification token' USING ERRCODE = '22023';
  END IF;
  IF _device_id IS NULL THEN
    RAISE EXCEPTION 'Missing device id' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.profiles (id) VALUES (_uid) ON CONFLICT (id) DO NOTHING;

  DELETE FROM public.push_devices
  WHERE token = _token AND NOT (user_id = _uid AND device_id = _device_id);
  UPDATE public.profiles SET fcm_token = NULL WHERE fcm_token = _token AND id <> _uid;

  INSERT INTO public.push_devices (token, user_id, device_id, project_id, updated_at)
  VALUES (_token, _uid, _device_id, _project_id, now())
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET token = EXCLUDED.token, project_id = EXCLUDED.project_id, updated_at = now();

  UPDATE public.profiles SET fcm_token = _token WHERE id = _uid;
END
$$;
REVOKE EXECUTE ON FUNCTION public.register_push_device(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, uuid, text) TO authenticated, service_role;

-- ===== Auth lifecycle: profile + student role on signup =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== Designated admin (verified email only) =====
CREATE OR REPLACE FUNCTION public.grant_designated_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND lower(NEW.email) = 'sumit.workplac@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_designated_admin() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER grant_designated_admin_on_signup
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_designated_admin();
CREATE TRIGGER grant_designated_admin_on_verified_signin
AFTER UPDATE OF email, email_confirmed_at, last_sign_in_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_designated_admin();

REVOKE EXECUTE ON FUNCTION public.validate_new_order() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_order_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_scheduled_order_fee() FROM PUBLIC, anon, authenticated;

-- Backfill any accounts that already exist in this project
INSERT INTO public.profiles (id, full_name)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
FROM auth.users u ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'student'::public.app_role FROM auth.users u ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role FROM auth.users u
WHERE u.email_confirmed_at IS NOT NULL AND lower(u.email) = 'sumit.workplac@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- ===== Storage access rules =====
CREATE POLICY "Admins read catalog media" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'catalog-media' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upload catalog media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'catalog-media' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update catalog media" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'catalog-media' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'catalog-media' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete catalog media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'catalog-media' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Signed-in users view payment QR and own refund proofs" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-assets' AND (
      public.has_role(auth.uid(), 'admin')
      OR name LIKE 'upi/%'
      OR (name LIKE 'refunds/%' AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.student_id = auth.uid() AND storage.objects.name LIKE 'refunds/' || o.id::text || '-%'
      ))
    )
  );
CREATE POLICY "Admins upload payment assets" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-assets' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update payment assets" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-assets' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'payment-assets' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete payment assets" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-assets' AND public.has_role(auth.uid(), 'admin'));

-- ===== Live updates =====
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders, public.products, public.categories, public.banners, public.app_settings, public.broadcasts;