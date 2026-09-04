import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function VideoCallScreen() {
  const params = useLocalSearchParams();
  const matchId = typeof params.matchId === "string" && params.matchId.trim() ? params.matchId : null;
  const router = useRouter();
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);

  if (!matchId) {
    return <View style={styles.container}><View style={styles.remoteVideo}><Text accessibilityRole="alert" style={styles.waitingText}>No valid match was selected.</Text><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()}><Text style={styles.backText}>Go back</Text></Pressable></View></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.remoteVideo}>
        <Text style={styles.waitingText}>Waiting for other person...</Text>
      </View>

      <View style={styles.localVideo}>
        <Text style={styles.localLabel}>You</Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={[styles.controlBtn, muted && styles.controlBtnActive]}
          onPress={() => setMuted(!muted)}
          accessibilityRole="button"
          accessibilityLabel={muted ? "Unmute microphone" : "Mute microphone"}
        >
          <Text style={styles.controlIcon}>{muted ? "🔇" : "🎤"}</Text>
          <Text style={styles.controlLabel}>{muted ? "Unmute" : "Mute"}</Text>
        </Pressable>

        <Pressable
          style={[styles.controlBtn, styles.endCallBtn]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="End call"
        >
          <Text style={[styles.controlIcon, { fontSize: 28 }]}>📞</Text>
          <Text style={[styles.controlLabel, { color: "#fff" }]}>End</Text>
        </Pressable>

        <Pressable
          style={[styles.controlBtn, videoOff && styles.controlBtnActive]}
          onPress={() => setVideoOff(!videoOff)}
          accessibilityRole="button"
          accessibilityLabel={videoOff ? "Turn video on" : "Turn video off"}
        >
          <Text style={styles.controlIcon}>{videoOff ? "📷" : "🎥"}</Text>
          <Text style={styles.controlLabel}>{videoOff ? "Video On" : "Video Off"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  remoteVideo: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#222",
  },
  waitingText: { color: "#888", fontSize: 16 },
  backText: { color: "#fff", fontSize: 16, marginTop: 16, textDecorationLine: "underline" },
  localVideo: {
    position: "absolute",
    top: 60,
    right: 16,
    width: 100,
    height: 140,
    backgroundColor: "#333",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  localLabel: { color: "#aaa", fontSize: 13 },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
    paddingVertical: 24,
    paddingBottom: 48,
    backgroundColor: "#111",
  },
  controlBtn: {
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    minWidth: 70,
  },
  controlBtnActive: { backgroundColor: "#333" },
  endCallBtn: { backgroundColor: "#e11d48", borderRadius: 50, padding: 16 },
  controlIcon: { fontSize: 24, marginBottom: 4 },
  controlLabel: { fontSize: 11, color: "#aaa" },
});
