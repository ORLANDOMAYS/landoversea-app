"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AppPage() {
  const [status, setStatus] = useState("loading...");
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    async function run() {
      const result = await supabase.from("items").select("*").order("created_at", { ascending: false });
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
<h3>Add Item</h3>

<form
  onSubmit={async (e) => {
    e.preventDefault();

    const form = e.target as any;

    const newItem = {
      title: form.title.value,
      description: form.description.value,
      location: form.location.value,
      price: Number(form.price.value),
    };

    const { error } = await supabase.from("items").insert([newItem]);

    if (error) {
      alert(error.message);
    } else {
      form.reset();
      window.location.reload();
    }
  }}
  style={{ marginBottom: 30 }}
>
  <input name="title" placeholder="Title" required />
  <br />

  <input name="description" placeholder="Description" required />
  <br />

  <input name="location" placeholder="Location" required />
  <br />

  <input name="price" type="number" placeholder="Price" required />
  <br />

  <button type="submit">Add Item</button>
</form>
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
