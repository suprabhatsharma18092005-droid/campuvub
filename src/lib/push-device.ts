import { supabase } from "@/integrations/supabase/client";

import { FIREBASE_PROJECT_ID } from "./firebase-config";

/**
 * Saves this browser's notification token for the signed-in user through the
 * database's sign-in-protected register_push_device function (which stores the
 * device token in `push_devices` AND `profiles.fcm_token`).
 */
export async function savePushDevice(token: string, deviceId: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user.id) {
    throw new Error("Sign in first to save notifications to your profile.");
  }

  const { error } = await supabase.rpc("register_push_device", {
    _token: token,
    _device_id: deviceId,
    _project_id: FIREBASE_PROJECT_ID,
  });
  if (error) throw new Error(error.message);

  // Best-effort client profile mirror in case the RPC ran against a mock or legacy schema.
  await supabase
    .from("profiles")
    .update({ fcm_token: token })
    .eq("id", session.user.id);
}
