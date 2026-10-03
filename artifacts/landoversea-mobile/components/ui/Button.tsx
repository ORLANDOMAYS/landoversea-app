import React from 'react';
import { StyleSheet, Text, Pressable, PressableProps, ActivityIndicator, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import * as Haptics from 'expo-haptics';

interface ButtonProps extends PressableProps {
  title?: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export function Button({
  title,
  variant = 'primary',
  size = 'default',
  loading = false,
  leftIcon,
  rightIcon,
  style,
  disabled,
  onPress,
  ...props
}: ButtonProps) {
  const colors = useColors();

  const handlePress = (e: any) => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.(e);
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      style={(state) => {
        const pressed = state.pressed;
        const propStyle = typeof style === 'function' ? style(state) : style;
        const isDisabled = disabled || loading;
        return [
          styles.base,
          styles[size],
          !isDisabled && variant === 'primary' && { backgroundColor: colors.primary },
          !isDisabled && variant === 'secondary' && { backgroundColor: colors.secondary },
          !isDisabled && variant === 'outline' && { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
          !isDisabled && variant === 'ghost' && { backgroundColor: 'transparent' },
          !isDisabled && variant === 'destructive' && { backgroundColor: colors.destructive },
          isDisabled && variant !== 'outline' && variant !== 'ghost' && { backgroundColor: colors.disabled },
          isDisabled && (variant === 'outline' || variant === 'ghost') && { borderColor: colors.disabledForeground, backgroundColor: 'transparent', borderWidth: variant === 'outline' ? 1 : 0 },
          pressed && styles.pressed,
          propStyle,
        ];
      }}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={
            (disabled || loading)
              ? colors.disabledForeground
              : (variant === 'outline' || variant === 'ghost'
                  ? colors.foreground
                  : colors.primaryForeground)
          }
        />
      ) : (
        <View style={styles.content}>
          {leftIcon}
          {title && (
            <Text
              style={[
                styles.text,
                size === 'lg' && styles.textLg,
                size === 'sm' && styles.textSm,
                !disabled && !loading && variant === 'primary' && { color: colors.primaryForeground },
                !disabled && !loading && variant === 'secondary' && { color: colors.secondaryForeground },
                !disabled && !loading && variant === 'outline' && { color: colors.foreground },
                !disabled && !loading && variant === 'ghost' && { color: colors.foreground },
                !disabled && !loading && variant === 'destructive' && { color: colors.destructiveForeground },
                (disabled || loading) && { color: colors.disabledForeground },
              ]}
            >
              {title}
            </Text>
          )}
          {rightIcon}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  default: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    minHeight: 52,
  },
  sm: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 36,
  },
  lg: {
    paddingVertical: 18,
    paddingHorizontal: 32,
    minHeight: 60,
  },
  icon: {
    padding: 12,
    minHeight: 48,
    minWidth: 48,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  text: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  textLg: {
    fontSize: 18,
  },
  textSm: {
    fontSize: 14,
  },
});
