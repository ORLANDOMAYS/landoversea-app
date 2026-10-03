import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { useColors } from '@/hooks/useColors';

export function GlassCard({ style, children, ...props }: ViewProps) {
  const colors = useColors();
  
  return (
    <View style={[styles.container, { borderColor: colors.border }, style]} {...props}>
      <View style={styles.blurClip}>
        <BlurView
          intensity={20}
          tint="default"
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={[styles.content, { backgroundColor: colors.glass }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    borderWidth: 1,
  },
  blurClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 23,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  content: {
    padding: 20,
    width: '100%',
    borderRadius: 23,
  }
});
