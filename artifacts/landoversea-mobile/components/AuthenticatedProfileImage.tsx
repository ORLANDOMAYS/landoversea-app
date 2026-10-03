import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ImageStyle, Pressable, StyleProp, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { getSessionToken } from '@/lib/auth';
import { resolveDomain } from '@/lib/appDomain';
import { useColors } from '@/hooks/useColors';

type Props = {
  url?: string | null;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel: string;
};

export function AuthenticatedProfileImage({ url, style, accessibilityLabel }: Props) {
  const colors = useColors();
  const [token, setToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => {
    if (!url) return null;
    const domain = resolveDomain();
    try {
      if (/^(https|file|content|blob|data):/i.test(url)) {
        return { uri: url };
      }
      if (!domain.ok) return null;
      const storageUrl = url.startsWith('/objects/')
        ? `/api/storage/objects/${url.slice('/objects/'.length)}`
        : url;
      const absolute = new URL(storageUrl, `${domain.origin}/`);
      if (absolute.protocol !== 'https:') return null;
      return {
        uri: absolute.toString(),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      };
    } catch {
      return null;
    }
  }, [token, url]);

  useEffect(() => {
    let active = true;
    setAuthReady(false);
    setFailed(false);
    getSessionToken()
      .then(value => {
        if (active) setToken(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });
    return () => {
      active = false;
    };
  }, [url]);

  if (!authReady) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.muted }, style]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!source || failed) {
    return (
      <View accessibilityLabel={accessibilityLabel} style={[styles.fallback, { backgroundColor: colors.muted }, style]}>
        <Ionicons name="person-outline" size={42} color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      source={source}
      style={style}
      contentFit="cover"
      onError={() => setFailed(true)}
    />
  );
}

type MediaProps = Props & {
  unavailableLabel: string;
  retryLabel: string;
  testID?: string;
};

export function AuthenticatedMediaImage({
  url,
  style,
  accessibilityLabel,
  unavailableLabel,
  retryLabel,
  testID,
}: MediaProps) {
  const colors = useColors();
  const [token, setToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const source = useMemo(() => {
    if (typeof url !== 'string' || !url.trim()) return null;
    try {
      if (/^(https|file|content):\/\//i.test(url)) return { uri: url };
      const domain = resolveDomain();
      if (!domain.ok) return null;
      const storageUrl = url.startsWith('/objects/')
        ? `/api/storage/objects/${url.slice('/objects/'.length)}`
        : url;
      const absolute = new URL(storageUrl, `${domain.origin}/`);
      if (absolute.protocol !== 'https:') return null;
      return {
        uri: absolute.toString(),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      };
    } catch {
      return null;
    }
  }, [token, url]);

  useEffect(() => {
    let active = true;
    setAuthReady(false);
    setFailed(false);
    getSessionToken()
      .then(value => {
        if (active) setToken(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });
    return () => {
      active = false;
    };
  }, [url, retryNonce]);

  if (!authReady) {
    return (
      <View style={[styles.mediaFallback, { backgroundColor: colors.muted }, style]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!source || failed) {
    return (
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLabel={unavailableLabel}
        testID={testID ? `${testID}-fallback` : undefined}
        style={[styles.mediaFallback, { backgroundColor: colors.muted }, style]}
      >
        <Ionicons name="image-outline" size={38} color={colors.mutedForeground} />
        <Text style={[styles.mediaFallbackText, { color: colors.mutedForeground }]}>{unavailableLabel}</Text>
        {source ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={retryLabel}
            testID={testID ? `${testID}-retry` : undefined}
            onPress={() => {
              setFailed(false);
              setRetryNonce(value => value + 1);
            }}
            style={[styles.retryButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>{retryLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      source={source}
      style={style}
      contentFit="cover"
      recyclingKey={`${url}-${retryNonce}`}
      testID={testID}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  mediaFallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 12 },
  mediaFallbackText: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 6, textAlign: 'center' },
  retryButton: { borderWidth: 1, borderRadius: 12, marginTop: 8, minHeight: 32, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});