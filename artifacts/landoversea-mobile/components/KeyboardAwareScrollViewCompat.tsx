import React from 'react';
import {
  Platform,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

export const FORM_ACTION_KEYBOARD_OFFSET = 80;

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  bottomOffset?: number;
  extraKeyboardSpace?: number;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
  keyboardDismissMode?: ScrollViewProps['keyboardDismissMode'];
  enabled?: boolean;
  testID?: string;
};

export function KeyboardAwareScrollViewCompat({
  children,
  style,
  contentContainerStyle,
  bottomOffset = 0,
  extraKeyboardSpace = 0,
  keyboardShouldPersistTaps = 'handled',
  keyboardDismissMode = Platform.OS === 'ios' ? 'interactive' : 'on-drag',
  enabled = true,
  testID,
}: Props) {
  const sharedProps = {
    style: [styles.scrollView, style],
    contentContainerStyle: [styles.contentContainer, contentContainerStyle],
    keyboardDismissMode,
    keyboardShouldPersistTaps,
    showsVerticalScrollIndicator: false,
    scrollEnabled: true,
    contentInsetAdjustmentBehavior: 'never',
    automaticallyAdjustContentInsets: false,
    testID,
  } satisfies ScrollViewProps;

  if (Platform.OS === 'web') {
    return (
      <ScrollView {...sharedProps}>
        {children}
      </ScrollView>
    );
  }

  return (
    <KeyboardAwareScrollView
      {...sharedProps}
      bottomOffset={bottomOffset}
      extraKeyboardSpace={extraKeyboardSpace}
      enabled={enabled}
      automaticallyAdjustKeyboardInsets={false}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    minHeight: 0,
  },
  contentContainer: {
    flexGrow: 1,
    width: '100%',
  },
});
