import React, { useState } from 'react';
import { View, StyleSheet, Text, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useDeleteAccount } from '@workspace/api-client-react';
import { performLogoutCleanup } from '@/lib/auth';

export default function DeleteAccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();
  
  const deleteAccount = useDeleteAccount();
  const [password, setPassword] = useState('');

  const handleDelete = () => {
    Alert.alert(
      t('profile.deleteAccount'),
      t('profile.deleteWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount.mutateAsync({ data: { confirmPassword: password } });
              await performLogoutCleanup();
              router.replace('/(auth)/welcome' as any);
            } catch (e) {
              Alert.alert(t('premium.genericError'), t('profile.deleteWrongPassword'));
            }
          }
        }
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Ionicons name="chevron-back" size={28} color={colors.foreground} onPress={() => router.back()} />
        <Text style={[styles.title, { color: colors.foreground }]}>{t('profile.deleteAccount')}</Text>
      </View>
      <View style={styles.content}>
        <Ionicons name="warning-outline" size={64} color={colors.destructive} />
        <Text style={[styles.text, { color: colors.foreground, marginTop: 16 }]}>{t('mobile.requestDeletion')}</Text>
        <Text style={[styles.desc, { color: colors.mutedForeground, marginTop: 8, marginBottom: 24 }]}>
          {t('profile.deleteWarning')}
        </Text>
        
        <Input
          placeholder={t('mobile.password')}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          containerStyle={{ width: '100%', marginBottom: 16 }}
        />
        
        <Button 
          title={t('profile.deleteConfirm')}
          variant="destructive" 
          style={{ width: '100%' }}
          onPress={handleDelete}
          disabled={!password || deleteAccount.isPending}
          loading={deleteAccount.isPending}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginLeft: 16 },
  content: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  desc: { fontFamily: 'Inter_400Regular', fontSize: 16, textAlign: 'center' }
});
