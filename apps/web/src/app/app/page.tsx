"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AppPage() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    supabase.from("profiles").select("*").limit(20).then(({ data, error }) => {
      if (error) setStatus(error.message);
      else setProfiles(data || []);
    });
  }, []);

  return (
    <div>
      <h2>Discover</h2>
      {status && <p>{status}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {profiles.map((p) => (
          <div key={p.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, background: "#fff" }}>
            <strong>{p.display_name || "Unnamed"}</strong>
            <p>{p.bio || "No bio yet."}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button>Pass</button>
              <button>Like</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
