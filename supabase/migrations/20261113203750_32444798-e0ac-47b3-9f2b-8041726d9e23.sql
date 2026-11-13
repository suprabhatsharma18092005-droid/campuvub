REVOKE EXECUTE ON FUNCTION public.is_vip(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.vip_free_quick_used_today(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_vip_subscription() FROM PUBLIC, anon, authenticated;