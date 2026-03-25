"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type Item = {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  location: string | null;
  image_url: string | null;
};

export default function AppPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    supabase
      .from("items")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setStatus(error.message);
        else setItems((data as Item[]) || []);
      });
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Discover</h2>
      {status && <p>{status}</p>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 12,
              background: "#fff",
            }}
          >
            <strong>{item.title}</strong>
            <p>{item.description || "No description."}</p>
            <p><strong>Price:</strong> ${item.price ?? "N/A"}</p>
            <p><strong>Location:</strong> {item.location || "N/A"}</p>
            {item.image_url ? (
              <img
                src={item.image_url}
                alt={item.title}
                style={{ width: "100%", borderRadius: 8, marginTop: 8 }}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
