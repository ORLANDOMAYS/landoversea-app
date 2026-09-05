import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  getCurrentUser,
  getProfile,
  getMatches,
  getMessages,
  sendMessage,
  subscribeToMessages,
} from "../lib/api";
import { restoreFailedDraft } from "../lib/dating-state";

export default function ChatScreen() {
  const params = useLocalSearchParams();
  const matchId = typeof params.matchId === "string" && params.matchId.trim() ? params.matchId : null;
  const [userId, setUserId] = useState(null);
  const [myLang, setMyLang] = useState("en");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sendError, setSendError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const listRef = useRef(null);

  async function init() {
    if (!matchId) {
      setError("No valid chat was selected.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const user = await getCurrentUser();
      if (!user) throw new Error("Please sign in to open this chat.");
      setUserId(user.id);
      const [profile, msgs, matches] = await Promise.all([
        getProfile(user.id),
        getMessages(matchId),
        getMatches(user.id),
      ]);

      if (profile?.language) setMyLang(profile.language);
      setMessages(msgs);

      const match = matches.find((m) => m.id === matchId);
      if (!match) throw new Error("This match is unavailable or you do not have access.");
    } catch (err) {
      setError(err?.message || "Unable to load chat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    init();
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    setConnectionStatus("connecting");
    const channel = subscribeToMessages(
      matchId,
      (msg) => setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]),
      (status) => {
        if (status === "SUBSCRIBED") setConnectionStatus("connected");
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setConnectionStatus("disconnected");
        else setConnectionStatus("connecting");
      }
    );
    return () => {
      if (channel?.unsubscribe) channel.unsubscribe();
    };
  }, [matchId, userId, subscriptionKey]);

  async function handleSend() {
    if (!input.trim() || !userId || !matchId || sending) return;
    setSending(true);
    setSendError(null);
    const body = input.trim();
    setInput("");

    try {
      const sent = await sendMessage(matchId, userId, body, myLang);
      if (sent) setMessages((prev) => prev.some((message) => message.id === sent.id) ? prev : [...prev, sent]);
    } catch (err) {
      setInput((current) => restoreFailedDraft(current, body));
      setSendError(err?.message || "Message failed to send. Please retry.");
    } finally {
      setSending(false);
    }
  }

  function renderMessage({ item }) {
    const isMe = item.sender_id === userId;
    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowRight : styles.msgRowLeft]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
          <Text style={[styles.msgText, isMe && { color: "#fff" }]}>{item.body}</Text>
          {item.translated_body && item.translated_body !== item.body && (
            <Text style={[styles.translated, isMe && { color: "rgba(255,255,255,0.7)" }]}>
              {item.translated_body}
            </Text>
          )}
        </View>
      </View>
    );
  }

  if (loading) {
    return <View style={styles.center}><Text style={styles.statusText}>Loading chat…</Text></View>;
  }

  if (error) {
    return <View style={styles.center}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading chat" style={styles.retryBtn} onPress={init}><Text style={styles.retryText}>Retry</Text></Pressable></View>;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {connectionStatus !== "connected" && (
        <View style={styles.connectionRow}>
          <Text accessibilityRole="text" style={styles.connectionText}>{connectionStatus === "connecting" ? "Connecting to live messages…" : "Live messages disconnected."}</Text>
          {connectionStatus === "disconnected" && <Pressable accessibilityRole="button" accessibilityLabel="Reconnect live messages" onPress={() => setSubscriptionKey((key) => key + 1)}><Text style={styles.reconnectText}>Reconnect</Text></Pressable>}
        </View>
      )}
      <View style={styles.translationNotice}>
        <Text style={styles.translationNoticeText}>
          Automatic translation is currently unavailable. Messages are sent in their original language.
        </Text>
      </View>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      />
      {sendError && <Text accessibilityRole="alert" style={styles.sendError}>{sendError}</Text>}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          multiline
          accessibilityLabel="Message"
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.5 }]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel={sending ? "Sending message" : "Send message"}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#f9fafb" },
  statusText: { color: "#666", fontSize: 16 },
  errorText: { color: "#b91c1c", fontSize: 16, textAlign: "center" },
  retryBtn: { marginTop: 16, backgroundColor: "#e11d48", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  retryText: { color: "#fff", fontWeight: "700" },
  connectionRow: { flexDirection: "row", justifyContent: "center", gap: 8, padding: 8, backgroundColor: "#fffbeb" },
  connectionText: { color: "#92400e", fontSize: 12 },
  reconnectText: { color: "#92400e", fontSize: 12, fontWeight: "700", textDecorationLine: "underline" },
  translationNotice: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#fffbeb", borderBottomWidth: 1, borderBottomColor: "#fde68a" },
  translationNoticeText: { color: "#78350f", fontSize: 12, textAlign: "center" },
  sendError: { color: "#b91c1c", paddingHorizontal: 16, paddingVertical: 6, backgroundColor: "#fef2f2" },
  msgRow: { marginBottom: 8 },
  msgRowRight: { alignItems: "flex-end" },
  msgRowLeft: { alignItems: "flex-start" },
  bubble: { maxWidth: "80%", padding: 12, borderRadius: 16 },
  bubbleMe: { backgroundColor: "#e11d48", borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: "#fff", borderBottomLeftRadius: 4, borderWidth: 1, borderColor: "#eee" },
  msgText: { fontSize: 16, color: "#333" },
  translated: { fontSize: 13, color: "#888", marginTop: 4, fontStyle: "italic" },
  inputRow: {
    flexDirection: "row",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "#fff",
    alignItems: "flex-end",
  },
  input: { flex: 1, borderWidth: 1, borderColor: "#ddd", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16, maxHeight: 100 },
  sendBtn: { backgroundColor: "#e11d48", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20, marginLeft: 8 },
  sendText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
