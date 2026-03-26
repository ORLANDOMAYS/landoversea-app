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

