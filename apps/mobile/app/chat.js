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
  getMessages,
  sendMessage,
  subscribeToMessages,
} from "../lib/api";
import { translateText } from "../lib/translate";

export default function ChatScreen() {
  const { matchId, userId: paramUserId } = useLocalSearchParams();
  const [userId, setUserId] = useState(paramUserId || null);
  const [myLang, setMyLang] = useState("en");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    async function init() {
      const user = await getCurrentUser();
      if (!user) return;
      setUserId(user.id);
      const profile = await getProfile(user.id);
      if (profile?.language) setMyLang(profile.language);
      const msgs = await getMessages(matchId);
      setMessages(msgs);
    }
    init();
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    const channel = subscribeToMessages(matchId, (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    return () => {
      if (channel?.unsubscribe) channel.unsubscribe();
    };
  }, [matchId]);

  async function handleSend() {
    if (!input.trim() || !userId || sending) return;
    setSending(true);
    const body = input.trim();
    setInput("");

    let translated = null;
    try {
      translated = await translateText(body, myLang, myLang === "en" ? "es" : "en");
    } catch {
      // translation failed, send without
    }

    await sendMessage(matchId, userId, body, myLang, translated);
    setSending(false);
  }

  function renderMessage({ item }) {
    const isMe = item.sender_id === userId;
    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowRight : styles.msgRowLeft]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
          <Text style={[styles.msgText, isMe && { color: "#fff" }]}>{item.body}</Text>
          {item.translated_body && (
            <Text style={[styles.translated, isMe && { color: "rgba(255,255,255,0.7)" }]}>
              {item.translated_body}
            </Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.5 }]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
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
