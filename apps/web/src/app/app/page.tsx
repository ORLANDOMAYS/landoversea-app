"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AppPage() {
  const [user, setUser] = useState<null | { email?: string }>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    }).catch(() => {
      setUser(null);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return (
      <div>
        <p>You are not logged in.</p>
        <p>
          <a href="/auth">Go to Login</a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2>Welcome</h2>
      <p>Logged in as {user.email}</p>
    </div>
  );
}
