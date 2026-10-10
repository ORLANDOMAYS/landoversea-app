import React, { useState } from 'react';
import { View, StyleSheet, Text, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useRequestAccountDeletion } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { GlassCard } from '@/components/ui/GlassCard';

export default function DeleteAccountRequestScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const router = useRouter();
  
  const requestDeletion = useRequestAccountDeletion();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!email) return;
    try {
      await requestDeletion.mutateAsync({ data: { email } });
      setSubmitted(true);
    } catch (e) {
      // Non-enumerating success: still show success to avoid email probing
      setSubmitted(true);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 24, paddingBottom: 24 }}>
      <View style={styles.header}>
        <Ionicons name="chevron-back" size={28} color={colors.foreground} onPress={() => router.back()} style={{ marginLeft: -8 }} />
      </View>
      
      <GlassCard style={styles.content}>
        <Ionicons name="warning-outline" size={64} color={colors.destructive} style={{ alignSelf: 'center', marginBottom: 16 }} />
        <Text style={[styles.title, { color: colors.foreground }]}>{t('mobile.requestDeletion')}</Text>
        
        {submitted ? (
          <View>
            <Text style={[styles.desc, { color: colors.mutedForeground }]}>
              If an account matches that email, a deletion link has been sent. Please check your inbox to proceed.
            </Text>
            <Button title={t('mobile.backToWelcome')} onPress={() => router.replace('/(auth)/welcome' as any)} style={{ marginTop: 24 }} />
          </View>
        ) : (
          <View>
            <Text style={[styles.desc, { color: colors.mutedForeground }]}>
              Enter your email address. We will send you a secure link to permanently delete your account and all associated data.
            </Text>
            
            <Input
              placeholder={t('deleteAccount.emailLabel')}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              containerStyle={{ marginTop: 24, marginBottom: 16 }}
            />
            
            <Button 
              title={t('mobile.sendDeletionRequest')}
              variant="destructive" 
              onPress={handleSubmit}
              disabled={!email || requestDeletion.isPending}
              loading={requestDeletion.isPending}
            />
          </View>
        )}
      </GlassCard>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingVertical: 16, marginBottom: 16 },
  content: { padding: 24 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24, textAlign: 'center', marginBottom: 16 },
  desc: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', lineHeight: 22 }
});
