import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function NotFoundScreen() {
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            This screen doesn&apos;t exist.
          </Text>
          <Link href="/" style={styles.link}>
            <Text style={[styles.linkText, { color: colors.primary }]}>Go to home screen</Text>
          </Link>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    marginTop: 15,
    minHeight: 44,
    paddingVertical: 13,
    paddingHorizontal: 12,
  },
  linkText: {
    fontSize: 14,
  },
});
