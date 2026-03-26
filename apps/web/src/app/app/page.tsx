"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AppPage() {
  const [status, setStatus] = useState("loading...");
  const [items, setItems] = useState<any[]>([]);
  const [debug, setDebug] = useState<any>(null);

  useEffect(() => {
    async function run() {
      const result = await supabase.from("items").select("*").order("created_at", { ascending: false });

      setDebug({
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        error: result.error,
        count: result.data?.length ?? 0,
      });

      if (result.error) {
        setStatus(result.error.message);
      } else {
        setStatus("success");
        setItems(result.data || []);
      }
    }

    run();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Discover</h2>
      <p>Status: {status}</p>

      <pre style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>
        {JSON.stringify(debug, null, 2)}
      </pre>

      {items.map((item) => (
        <div key={item.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
          <strong>{item.title}</strong>
          <p>{item.description}</p>
          <p>{item.location}</p>
          <p>{item.price}</p>
        </div>
      ))}
    </div>
  );
}
Then do this
Save the file in GitHub.
Redeploy in Vercel with Use existing Build Cache unchecked.
Open /app.
Send me a screenshot of the page.
Why this will solve it

This will show us, on the live page itself:

which Supabase URL the deployed app is actually using
whether the anon key is present
the exact live error object coming back from Supabase
whether data is returning but not rendering

Right now the DB is verified, so this diagnostic page is the fastest way to catch the real last issue.
