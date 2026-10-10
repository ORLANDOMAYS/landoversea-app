import React from 'react';
import { StyleSheet, TextInput, TextInputProps, View, Text } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface InputProps extends TextInputProps {
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: import('react-native').StyleProp<import('react-native').ViewStyle>;
}

export const Input = React.forwardRef<TextInput, InputProps>(
  ({
    error,
    leftIcon,
    rightIcon,
    style,
    containerStyle,
    editable = true,
    placeholderTextColor,
    ...props
  }, ref) => {
    const colors = useColors();

    return (
      <View style={[styles.container, containerStyle]}>
        <View
          style={[
            styles.inputContainer,
            {
              backgroundColor: editable ? colors.input : colors.disabled,
              borderColor: error ? colors.destructive : colors.border,
            },
          ]}
        >
          {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
          <TextInput
            ref={ref}
            style={[
              styles.input,
              { color: editable ? colors.foreground : colors.disabledForeground },
              style,
            ]}
            editable={editable}
            placeholderTextColor={placeholderTextColor ?? colors.placeholder}
            {...props}
          />
          {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
        </View>
        {error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}
      </View>
    );
  }
);

Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    minHeight: 52,
  },
  input: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    paddingVertical: 14,
  },
  leftIcon: {
    marginRight: 12,
  },
  rightIcon: {
    marginLeft: 12,
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
});
