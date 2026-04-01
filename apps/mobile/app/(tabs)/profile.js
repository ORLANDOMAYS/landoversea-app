import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert, Image } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { getCurrentUser, getProfile, upsertProfile, getPhotos, uploadPhoto } from "../../lib/api";

export default function ProfileScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [language, setLanguage] = useState("en");
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (!user) return;
      setUserId(user.id);
      getProfile(user.id).then((p) => {
        if (p) {
          setName(p.display_name || "");
          setBio(p.bio || "");
          setAge(p.age ? String(p.age) : "");
          setGender(p.gender || "");
          setLanguage(p.language || "en");
        }
      });
      getPhotos(user.id).then(setPhotos);
    });
  }, []);

  async function save() {
    if (!userId) return;
    setSaving(true);
    await upsertProfile(userId, {
      display_name: name,
      bio,
      age: age ? parseInt(age) : null,
      gender,
      language,
    });
    setSaving(false);
    Alert.alert("Saved", "Profile updated successfully!");
  }

  async function pickPhoto() {
    if (!userId) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const photo = await uploadPhoto(userId, result.assets[0].uri, photos.length);
      if (photo) setPhotos((prev) => [...prev, photo]);
    }
  }

  if (!userId) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Please log in to edit your profile</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.section}>Photos</Text>
      <View style={styles.photosRow}>
        {photos.map((p) => (
          <Image key={p.id} source={{ uri: p.url }} style={styles.photo} />
        ))}
        <Pressable style={styles.addPhoto} onPress={pickPhoto}>
          <Text style={{ fontSize: 28, color: "#999" }}>+</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>About You</Text>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" />

      <Text style={styles.label}>Bio</Text>
      <TextInput
        style={[styles.input, { height: 80, textAlignVertical: "top" }]}
        value={bio}
        onChangeText={setBio}
        placeholder="Tell others about yourself..."
        multiline
      />

      <Text style={styles.label}>Age</Text>
      <TextInput style={styles.input} value={age} onChangeText={setAge} placeholder="25" keyboardType="numeric" />

      <Text style={styles.label}>Gender</Text>
      <View style={styles.genderRow}>
        {["male", "female", "non-binary"].map((g) => (
          <Pressable
            key={g}
            style={[styles.genderBtn, gender === g && styles.genderActive]}
            onPress={() => setGender(g)}
          >
            <Text style={[styles.genderText, gender === g && styles.genderTextActive]}>
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        <Text style={styles.saveBtnText}>{saving ? "Saving..." : "Save Profile"}</Text>
      </Pressable>

      <Pressable style={styles.verifyBtn} onPress={() => router.push("/verify")}>
        <Text style={styles.verifyBtnText}>Verify Profile</Text>
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyText: { fontSize: 16, color: "#666" },
  section: { fontSize: 20, fontWeight: "700", marginTop: 16, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 14, fontSize: 16 },
  photosRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 90, height: 90, borderRadius: 10 },
  addPhoto: {
    width: 90,
    height: 90,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#ddd",
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },
  genderRow: { flexDirection: "row", gap: 8 },
  genderBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#ddd", alignItems: "center" },
  genderActive: { borderColor: "#e11d48", backgroundColor: "#fef2f2" },
  genderText: { color: "#666" },
  genderTextActive: { color: "#e11d48", fontWeight: "600" },
  saveBtn: { backgroundColor: "#e11d48", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 24 },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  verifyBtn: { borderWidth: 1, borderColor: "#e11d48", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 12 },
  verifyBtnText: { color: "#e11d48", fontSize: 16, fontWeight: "700" },
});
