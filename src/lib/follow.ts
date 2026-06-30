import { db } from "@/integrations/firebase/client";
import { doc, setDoc, deleteDoc } from "firebase/firestore";

// One follow doc per (user, company), id = `${uid}_${companyId}` so toggling is idempotent.
export const followId = (uid: string, companyId: string) => `${uid}_${companyId}`;

export async function followCompany(uid: string, companyId: string) {
  await setDoc(doc(db, "follows", followId(uid, companyId)), {
    user_id: uid, company_id: companyId, created_at: new Date().toISOString(),
  });
}

export async function unfollowCompany(uid: string, companyId: string) {
  await deleteDoc(doc(db, "follows", followId(uid, companyId)));
}
