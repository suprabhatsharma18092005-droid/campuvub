import { supabase } from "@/integrations/supabase/client";

import { FIREBASE_PROJECT_ID } from "./firebase-config";

/**
 * Saves this browser's notification token for the signed-in user through the
 * database's sign-in-protected register_push_device function. Runs directly
 * from the browser, so any host (Lovable or Vercel) works without server keys.
 */
export async function savePushDevice(token: string, deviceId: string): Promise<void> {
  const { error } = await supabase.rpc("register_push_device", {
    _token: token,
    _device_id: deviceId,
    _project_id: FIREBASE_PROJECT_ID,
  });
  if (error) throw new Error(error.message);
}
