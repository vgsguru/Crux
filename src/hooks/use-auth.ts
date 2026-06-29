import { useEffect, useState } from "react";
import { auth, db } from "@/integrations/firebase/client";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

export type AppRole = "admin" | "recruiter" | "applicant";

// Firebase User with .id alias for .uid for backwards compatibility
export type AppUser = User & { id: string };

export function useAuth() {
  const [session, setSession] = useState<any | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      // Normalize Firebase user to include .id as alias for .uid
      const normalizedUser = u ? Object.assign(u, { id: u.uid }) as AppUser : null;
      setUser(normalizedUser);
      if (u) {
        // Fetch role from Firestore users collection
        try {
          const userDoc = await getDoc(doc(db, "users", u.uid));
          if (userDoc.exists()) {
            const r = userDoc.data()?.role;
            if (r) {
              setRoles(Array.isArray(r) ? r : [r]);
            } else {
              setRoles(["applicant"]); // Default role
            }
          } else {
            setRoles([]);
          }
        } catch (error) {
          console.error("Error fetching user role", error);
        }
      } else {
        setRoles([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return {
    session: user ? { user } : null,
    user,
    roles,
    loading,
    isRecruiter: roles.includes("recruiter"),
    isApplicant: roles.includes("applicant"),
    isAdmin: roles.includes("admin"),
  };
}

