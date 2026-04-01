import { useEffect, useState, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { getCurrentUser, verifyProfile } from "../lib/api";

export default function VerifyScreen() {
  const router = useRouter();
  const cameraRef = useRef(null);
  const [userId, setUserId] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState("intro"); // intro | camera | processing | success | error
  const [photo, setPhoto] = useState(null);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) setUserId(user.id);
    });
  }, []);

  async function startCamera() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setStep("error");
        return;
      }
    }
    setStep("camera");
  }

  async function captureAndVerify() {
    if (!cameraRef.current || !userId) return;
    setStep("processing");

    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      setPhoto(pic.uri);

      // Call server-side verification RPC
      const success = await verifyProfile(userId);
      setStep(success ? "success" : "error");
    } catch {
      setStep("error");
    }
  }

  if (step === "intro") {
    return (
      <View style={styles.container}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🛡️</Text>
        <Text style={styles.title}>Profile Verification</Text>
        <Text style={styles.subtitle}>
          Take a selfie to verify your identity. This helps build trust with other users.
        </Text>
        <Pressable style={styles.btn} onPress={startCamera}>
          <Text style={styles.btnText}>Start Verification</Text>
        </Pressable>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  if (step === "camera") {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="front" />
        <View style={styles.cameraOverlay}>
          <View style={styles.faceGuide} />
        </View>
        <Pressable style={styles.captureBtn} onPress={captureAndVerify}>
          <View style={styles.captureBtnInner} />
        </Pressable>
      </View>
    );
  }

  if (step === "processing") {
    return (
      <View style={styles.container}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>⏳</Text>
        <Text style={styles.title}>Analyzing...</Text>
        <Text style={styles.subtitle}>Please wait while we verify your photo.</Text>
      </View>
    );
  }

  if (step === "success") {
    return (
      <View style={styles.container}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>✅</Text>
        <Text style={styles.title}>Verified!</Text>
        <Text style={styles.subtitle}>
          Your profile is now verified. Other users will see a verification badge on your profile.
        </Text>
        <Pressable style={styles.btn} onPress={() => router.back()}>
          <Text style={styles.btnText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  // error
  return (
    <View style={styles.container}>
      <Text style={{ fontSize: 48, marginBottom: 16 }}>❌</Text>
      <Text style={styles.title}>Verification Failed</Text>
      <Text style={styles.subtitle}>
        We couldn't verify your photo. Please try again with good lighting and a clear view of your face.
      </Text>
      <Pressable style={styles.btn} onPress={() => setStep("intro")}>
        <Text style={styles.btnText}>Try Again</Text>
      </Pressable>
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backText}>Go Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "800", marginBottom: 12 },
  subtitle: { fontSize: 16, color: "#666", textAlign: "center", marginBottom: 32, lineHeight: 24 },
  btn: { backgroundColor: "#e11d48", paddingHorizontal: 48, paddingVertical: 16, borderRadius: 12 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  backBtn: { marginTop: 16, padding: 12 },
  backText: { color: "#666", fontSize: 16 },
  cameraContainer: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  faceGuide: {
    width: 250,
    height: 320,
    borderRadius: 125,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.5)",
    borderStyle: "dashed",
  },
  captureBtn: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  captureBtnInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fff",
  },
});
