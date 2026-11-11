DROP POLICY "Anyone reads active banners" ON public.banners;
CREATE POLICY "Visitors read active banners" ON public.banners FOR SELECT TO anon
  USING (is_active);
CREATE POLICY "Signed-in users read active banners, admins read all" ON public.banners FOR SELECT TO authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'));

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;