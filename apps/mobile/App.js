import React, { useState } from "react";
import { SafeAreaView, Text, TextInput, Pressable, View } from "react-native";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

export default function App() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");

  async function sendLink() {
    const { error } = await supabase.auth.signInWithOtp({ email });
    setStatus(error ? error.message : "Check your email for the login link.");
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 24, fontWeight: "700", marginBottom: 12 }}>LandOverSea</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@email.com"
        style={{ borderWidth: 1, padding: 12, marginBottom: 12 }}
      />
      <Pressable onPress={sendLink} style={{ backgroundColor: "black", padding: 12 }}>
        <Text style={{ color: "white" }}>Send Login Link</Text>
      </Pressable>
      {!!status && <Text style={{ marginTop: 12 }}>{status}</Text>}
    </SafeAreaView>
  );
}
