import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export interface Profile {
  id: string;
  username: string | null;
  country_code: string;
  match_scope: "SAME_COUNTRY" | "ALL_COUNTRIES" | "REGION";
  age_verification_status: "unverified" | "pending" | "verified" | "rejected";
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    if (!session?.user) return;
    const { data } = await supabase
      .from("profiles")
      .select("id, username, country_code, match_scope, age_verification_status")
      .eq("id", session.user.id)
      .single();
    setProfile(data as Profile | null);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      return;
    }
    supabase
      .from("profiles")
      .select("id, username, country_code, match_scope, age_verification_status")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => setProfile(data as Profile | null));
  }, [session?.user?.id]);

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });

  const signOut = () => supabase.auth.signOut();

  return { session, profile, loading, signInWithGoogle, signOut, refreshProfile };
}
