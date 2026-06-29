import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAdminDb, getAdminAuth } from "@/integrations/firebase/admin";

// Resolve a username handle → account email so users can sign in with their handle.
// Public (pre-auth) by necessity; only returns the email for an existing handle.
export const lookupLoginEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ handle: z.string().min(1).max(40) }).parse(input))
  .handler(async ({ data }) => {
    const handle = data.handle.trim().toLowerCase().replace(/^@/, "");
    const db = await getAdminDb();
    const snap = await db.collection("usernames").doc(handle).get();
    if (!snap.exists) return { email: null as string | null };
    const uid = (snap.data() as { uid?: string }).uid;
    if (!uid) return { email: null };
    try {
      const user = await (await getAdminAuth()).getUser(uid);
      return { email: user.email ?? null };
    } catch {
      return { email: null };
    }
  });
