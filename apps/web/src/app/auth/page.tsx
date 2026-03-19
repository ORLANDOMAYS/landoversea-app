"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");

  async function sendLink() {
    setStatus("Sending...");
    const { error } = await supabase.auth.signInWithOtp({ email });
    setStatus(error ? error.message : "Check your email for the login link.");
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h2>Login</h2>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
      />
      <button onClick={sendLink}>Send Login Link</button>
      {status && <p>{status}</p>}
    </div>
  );
}
