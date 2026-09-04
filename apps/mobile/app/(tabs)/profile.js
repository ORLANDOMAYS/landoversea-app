import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert, Image } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { getCurrentUser, getProfile, upsertProfile, getPhotos, uploadPhoto, deletePhoto } from "../../lib/api";
import { getAuthDestination } from "../../lib/auth-gate";

export default function ProfileScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [language, setLanguage] = useState("en");
  const [interestedIn, setInterestedIn] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!user) return;
        setUserId(user.id);
        const [p, loadedPhotos] = await Promise.all([getProfile(user.id), getPhotos(user.id)]);
        if (p) {
          setName(p.display_name || "");
          setBio(p.bio || "");
          setAge(p.age ? String(p.age) : "");
          setGender(p.gender || "");
          setLanguage(p.language || "en");
          setInterestedIn(p.interested_in || "");
          setCity(p.city || "");
          setCountry(p.country || "");
        }
        setPhotos(loadedPhotos);
      } catch (error) {
        setLoadError(error?.message || "Unable to load profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    if (!userId) return;
    setSaving(true);
    try {
      await upsertProfile(userId, {
        display_name: name || null,
        bio: bio || null,
        age: age ? parseInt(age, 10) : null,
        gender: gender || null,
        interested_in: interestedIn || null,
        city: city || null,
        country: country || null,
        language,
      });
      Alert.alert("Saved", "Profile updated successfully!");
      const { destination } = await getAuthDestination();
      if (destination === "/(tabs)/discover") router.replace(destination);
    } catch (error) {
      Alert.alert("Unable to save", error?.message || "Failed to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function pickPhoto() {
    if (!userId || photos.length >= 6 || photoBusy) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoBusy(true);
      try {
        const photo = await uploadPhoto(userId, result.assets[0].uri, photos.length);
        if (photo) setPhotos((prev) => prev.length < 6 ? [...prev, photo] : prev);
      } catch (error) {
        Alert.alert("Unable to upload", error?.message || "Photo upload failed. Please try again.");
      } finally {
        setPhotoBusy(false);
      }
    }
  }

  async function removePhoto(photoId) {
    if (photoBusy) return;
    setPhotoBusy(true);
    try {
      await deletePhoto(photoId);
      setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
    } catch (error) {
      Alert.alert("Unable to delete", error?.message || "Photo deletion failed. Please try again.");
    } finally {
      setPhotoBusy(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><Text style={styles.emptyText}>Loading profile…</Text></View>;
  }

  if (loadError) {
    return <View style={styles.center}><Text accessibilityRole="alert" style={styles.errorText}>{loadError}</Text></View>;
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
          <View key={p.id}>
            <Image source={{ uri: p.url }} style={styles.photo} accessibilityLabel="Profile photo" />
            <Pressable accessibilityRole="button" accessibilityLabel="Delete profile photo" disabled={photoBusy} onPress={() => removePhoto(p.id)} style={styles.deletePhoto}><Text style={styles.deleteText}>×</Text></Pressable>
          </View>
        ))}
        {photos.length < 6 && <Pressable accessibilityRole="button" accessibilityLabel="Add profile photo" disabled={photoBusy} style={styles.addPhoto} onPress={pickPhoto}>
          <Text style={{ fontSize: 28, color: "#999" }}>+</Text>
        </Pressable>}
      </View>

      <Text style={styles.section}>About You</Text>
      <Text style={styles.label}>Name</Text>
      <TextInput accessibilityLabel="Display name" style={styles.input} value={name} onChangeText={setName} placeholder="Your name" />

      <Text style={styles.label}>Bio</Text>
      <TextInput
        style={[styles.input, { height: 80, textAlignVertical: "top" }]}
        value={bio}
        onChangeText={setBio}
        placeholder="Tell others about yourself..."
        multiline
        accessibilityLabel="Bio"
      />

      <Text style={styles.label}>Age</Text>
      <TextInput accessibilityLabel="Age" style={styles.input} value={age} onChangeText={setAge} placeholder="25" keyboardType="numeric" />

      <Text style={styles.label}>Gender</Text>
      <View style={styles.genderRow}>
        {["male", "female", "non-binary"].map((g) => (
          <Pressable
            key={g}
            style={[styles.genderBtn, gender === g && styles.genderActive]}
            onPress={() => setGender(g)}
            accessibilityRole="radio"
            accessibilityLabel={`Gender ${g}`}
            accessibilityState={{ selected: gender === g }}
          >
            <Text style={[styles.genderText, gender === g && styles.genderTextActive]}>
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Interested In</Text>
      <View style={styles.genderRow}>
        {["men", "women", "everyone"].map((value) => (
          <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`Interested in ${value}`} accessibilityState={{ selected: interestedIn === value }} style={[styles.genderBtn, interestedIn === value && styles.genderActive]} onPress={() => setInterestedIn(value)}>
            <Text style={[styles.genderText, interestedIn === value && styles.genderTextActive]}>{value.charAt(0).toUpperCase() + value.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>City</Text>
      <TextInput accessibilityLabel="City" style={styles.input} value={city} onChangeText={setCity} placeholder="City" />
      <Text style={styles.label}>Country</Text>
      <TextInput accessibilityLabel="Country" style={styles.input} value={country} onChangeText={setCountry} placeholder="Country" />

      <Pressable accessibilityRole="button" accessibilityLabel="Save profile" style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        <Text style={styles.saveBtnText}>{saving ? "Saving..." : "Save Profile"}</Text>
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyText: { fontSize: 16, color: "#666" },
  errorText: { fontSize: 16, color: "#b91c1c", textAlign: "center" },
  section: { fontSize: 20, fontWeight: "700", marginTop: 16, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 14, fontSize: 16 },
  photosRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 90, height: 90, borderRadius: 10 },
  deletePhoto: { position: "absolute", right: 4, top: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" },
  deleteText: { color: "#fff", fontSize: 20, lineHeight: 22 },
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
});
