import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useLiveMyProfile, useLivePhotoMutations, useLiveUpdateProfile } from '@/lib/liveSupabase';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';
import { AuthenticatedProfileImage } from '@/components/AuthenticatedProfileImage';

export default function ProfileEditScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();
  const profileQuery = useLiveMyProfile();
  const updateProfile = useLiveUpdateProfile();
  const photoMutations = useLivePhotoMutations();
  const uploadProfilePhoto = photoMutations.upload;
  const deleteProfilePhoto = photoMutations.remove;
  const reorderProfilePhoto = photoMutations.reorder;
  const setPrimaryProfilePhoto = photoMutations.primary;
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const photos = [...(profileQuery.data?.photos ?? [])]
    .sort((a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id)))
    .slice(0, 6);
  const photoMutationPending = uploadProfilePhoto.isPending || deleteProfilePhoto.isPending
    || reorderProfilePhoto.isPending || setPrimaryProfilePhoto.isPending;

  useEffect(() => {
    if (!profileQuery.data) return;
    setName(profileQuery.data.name);
    setBio(profileQuery.data.bio ?? '');
    setCountry(profileQuery.data.country ?? '');
    setCity(profileQuery.data.city ?? '');
  }, [profileQuery.data]);

  const save = async () => {
    if (!name.trim() || (bio.trim().length > 0 && bio.trim().length < 20)) {
      Alert.alert(t('premium.genericError'), t('onboarding.bioSubtitle'));
      return;
    }
    try {
      await updateProfile.mutateAsync({
        data: { name: name.trim(), bio: bio.trim(), country: country.trim(), city: city.trim() },
      });
      router.back();
    } catch {
      Alert.alert(t('premium.genericError'), t('mobile.saveFailed'));
    }
  };

  const uploadPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
      Alert.alert(t('onboarding.fileTooLarge'), t('onboarding.fileTooLargeDesc'));
      return;
    }
    try {
      await uploadProfilePhoto.mutateAsync({ data: { photo: {
        uri: asset.uri,
        name: asset.fileName ?? 'profile.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as string } });
      await profileQuery.refetch();
    } catch {
      Alert.alert(t('onboarding.photoUploadFailed'), t('onboarding.photoUploadFailedDesc'));
    }
  };

  const mutatePhoto = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
      await profileQuery.refetch();
    } catch {
      Alert.alert(t('premium.genericError'), t('mobile.saveFailed'));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('profile.editProfile')}</Text>
      </View>
      {profileQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : profileQuery.isError ? (
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: colors.foreground }]}>{t('errorBoundary.description')}</Text>
          <Button title={t('errorBoundary.tryAgain')} variant="outline" onPress={() => profileQuery.refetch()} />
        </View>
      ) : (
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          bottomOffset={20}
        >
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('editProfile.photos')}</Text>
          <Text style={[styles.photoHint, { color: colors.mutedForeground }]}>{t('editProfile.photoHint')}</Text>
          <View style={styles.photoGrid}>
            {photos.map((photo, index) => (
              <View key={photo.id} style={[styles.photoCard, { borderColor: photo.isPrimary ? colors.primary : colors.border }]}>
                <AuthenticatedProfileImage
                  url={photo.url}
                  style={styles.photo}
                  accessibilityLabel={t('editProfile.photoAlt', { number: index + 1 })}
                />
                <View style={styles.photoActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('common.back')} ${t('editProfile.photoAlt', { number: index + 1 })}`}
                    disabled={index === 0 || photoMutationPending}
                    onPress={() => mutatePhoto(() => reorderProfilePhoto.mutateAsync({ photoId: photo.id, data: { position: index - 1 } }))}
                    style={styles.iconButton}
                  ><Ionicons name="arrow-back" size={20} color={index === 0 ? colors.mutedForeground : colors.foreground} /></Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('editProfile.photoHint')}
                    disabled={photo.isPrimary || photoMutationPending}
                    onPress={() => mutatePhoto(() => setPrimaryProfilePhoto.mutateAsync({ photoId: photo.id }))}
                    style={styles.iconButton}
                  ><Ionicons name={photo.isPrimary ? 'star' : 'star-outline'} size={20} color={colors.primary} /></Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.delete')}
                    disabled={photos.length === 1 || photoMutationPending}
                    onPress={() => mutatePhoto(() => deleteProfilePhoto.mutateAsync({ photoId: photo.id }))}
                    style={styles.iconButton}
                  ><Ionicons name="trash-outline" size={20} color={colors.destructive} /></Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('common.next')} ${t('editProfile.photoAlt', { number: index + 1 })}`}
                    disabled={index === photos.length - 1 || photoMutationPending}
                    onPress={() => mutatePhoto(() => reorderProfilePhoto.mutateAsync({ photoId: photo.id, data: { position: index + 1 } }))}
                    style={styles.iconButton}
                  ><Ionicons name="arrow-forward" size={20} color={index === photos.length - 1 ? colors.mutedForeground : colors.foreground} /></Pressable>
                </View>
              </View>
            ))}
          </View>
          {photos.length < 6 && (
            <Button title={t('onboarding.uploadPhoto')} variant="outline" onPress={uploadPhoto} loading={uploadProfilePhoto.isPending} />
          )}
          <Input placeholder={t('onboarding.nameLabel')} value={name} onChangeText={setName} />
          <Input placeholder={t('onboarding.bioPlaceholder')} value={bio} onChangeText={setBio} multiline style={styles.bio} />
          <Input placeholder={t('onboarding.country')} value={country} onChangeText={setCountry} />
          <Input placeholder={t('onboarding.cityLabel')} value={city} onChangeText={setCity} />
          <Button title={t('common.save')} onPress={save} loading={updateProfile.isPending} disabled={!name.trim() || (bio.trim().length > 0 && bio.trim().length < 20)} />
        </KeyboardAwareScrollViewCompat>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginStart: 16 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  loader: { marginTop: 32 },
  content: { padding: 24, gap: 14 },
  bio: { minHeight: 120, textAlignVertical: 'top' },
  errorState: { padding: 24, gap: 16, alignItems: 'center' },
  errorText: { fontFamily: 'Inter_400Regular', textAlign: 'center' },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18 },
  photoHint: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  photoGrid: { gap: 12 },
  photoCard: { borderWidth: 2, borderRadius: 14, overflow: 'hidden' },
  photo: { width: '100%', height: 220 },
  photoActions: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});