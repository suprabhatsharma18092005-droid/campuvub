ALTER TABLE public.categories ALTER COLUMN emoji DROP NOT NULL;

CREATE TABLE public.subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subcategories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcategories TO authenticated;
GRANT ALL ON public.subcategories TO service_role;
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads active subcategories, admins read all" ON public.subcategories FOR SELECT TO anon, authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert subcategories" ON public.subcategories FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update subcategories" ON public.subcategories FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete subcategories" ON public.subcategories FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX subcategories_category_id_idx ON public.subcategories(category_id, sort_order);

CREATE TABLE public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcategory_id uuid NOT NULL REFERENCES public.subcategories(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.brands TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads active brands, admins read all" ON public.brands FOR SELECT TO anon, authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert brands" ON public.brands FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update brands" ON public.brands FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete brands" ON public.brands FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX brands_subcategory_id_idx ON public.brands(subcategory_id, sort_order);
CREATE INDEX brands_category_id_idx ON public.brands(category_id);

CREATE OR REPLACE FUNCTION public.sync_brand_category()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT category_id INTO NEW.category_id FROM public.subcategories WHERE id = NEW.subcategory_id;
  RETURN NEW;
END $$;
CREATE TRIGGER sync_brand_category BEFORE INSERT OR UPDATE OF subcategory_id, category_id ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.sync_brand_category();

ALTER TABLE public.products
  ADD COLUMN subcategory_id uuid REFERENCES public.subcategories(id) ON DELETE SET NULL,
  ADD COLUMN brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL;
CREATE INDEX products_subcategory_id_idx ON public.products(subcategory_id);
CREATE INDEX products_brand_id_idx ON public.products(brand_id);

CREATE OR REPLACE FUNCTION public.validate_product_hierarchy()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE parent uuid;
BEGIN
  IF NEW.brand_id IS NOT NULL THEN
    SELECT subcategory_id INTO parent FROM public.brands WHERE id = NEW.brand_id;
    IF NEW.subcategory_id IS NULL THEN
      NEW.subcategory_id := parent;
    ELSIF parent IS DISTINCT FROM NEW.subcategory_id THEN
      RAISE EXCEPTION 'This brand does not belong to the chosen subcategory.';
    END IF;
  END IF;
  IF NEW.subcategory_id IS NOT NULL THEN
    SELECT category_id INTO parent FROM public.subcategories WHERE id = NEW.subcategory_id;
    IF NEW.category_id IS NULL THEN
      NEW.category_id := parent;
    ELSIF parent IS DISTINCT FROM NEW.category_id THEN
      RAISE EXCEPTION 'This subcategory does not belong to the chosen category.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_product_hierarchy BEFORE INSERT OR UPDATE OF category_id, subcategory_id, brand_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_hierarchy();

ALTER PUBLICATION supabase_realtime ADD TABLE public.subcategories, public.brands;