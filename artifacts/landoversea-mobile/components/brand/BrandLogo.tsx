import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';

interface BrandLogoProps {
  width?: number;
  monochrome?: boolean;
  foreground?: string;
}

function BrandMark({ size, monochrome }: { size: number; monochrome: boolean }) {
  const pink = monochrome ? '#ffffff' : '#ec4899';
  const cyan = monochrome ? '#ffffff' : '#22d3ee';

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <Defs>
        <LinearGradient id="mobileBrandGradient" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={pink} />
          <Stop offset="1" stopColor={cyan} />
        </LinearGradient>
        <ClipPath id="mobileBrandGlobe">
          <Circle cx="50" cy="48" r="34" />
        </ClipPath>
      </Defs>
      <Circle cx="50" cy="48" r="34" fill="none" stroke="url(#mobileBrandGradient)" strokeWidth="3.5" />
      <G clipPath="url(#mobileBrandGlobe)" fill="none" stroke={cyan} strokeWidth="1.6" opacity={0.7}>
        <Path d="M16 48h68M50 14C38 25 32 36 32 48s6 23 18 34M50 14c12 11 18 22 18 34s-6 23-18 34M19 35h62M19 61h62" />
      </G>
      <Path d="M34 43c0-8 11-10 16-3 5-7 16-5 16 3 0 10-16 20-16 20S34 53 34 43Z" fill={pink} />
      <Path d="M11 66c19 10 40 12 61 3 7-3 12-7 17-12" fill="none" stroke="url(#mobileBrandGradient)" strokeWidth="5" strokeLinecap="round" />
      <Circle cx="89" cy="57" r="3.2" fill={cyan} />
    </Svg>
  );
}

export function BrandLogo({
  width = 280,
  monochrome = false,
  foreground: foregroundProp,
}: BrandLogoProps) {
  const foreground = monochrome ? '#ffffff' : foregroundProp ?? '#f8fafc';
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="LandOverSEA"
      style={[styles.row, { width }]}
    >
      <BrandMark size={Math.round(width * 0.28)} monochrome={monochrome} />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.wordmark, { color: foreground }]}
      >
        <Text style={{ color: monochrome ? foreground : '#ec4899' }}>Land</Text>
        <Text style={{ color: monochrome ? foreground : '#22d3ee' }}>Over</Text>
        <Text>SEA</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    flexShrink: 1,
    marginLeft: 8,
    fontFamily: 'Inter_700Bold',
    fontSize: 35,
    letterSpacing: -1.5,
  },
});