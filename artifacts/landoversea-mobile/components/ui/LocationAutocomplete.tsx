import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Input } from '@/components/ui/Input';
import {
  filterLocationOptions,
  type LocationOption,
} from '@/lib/location-data';

interface LocationAutocompleteProps {
  value: string;
  options: LocationOption[];
  selectedCode: string | null;
  placeholder: string;
  accessibilityLabel: string;
  noResultsText: string;
  testIDPrefix: string;
  onChangeText: (value: string) => void;
  onSelect: (option: LocationOption) => void;
}

export function LocationAutocomplete({
  value,
  options,
  selectedCode,
  placeholder,
  accessibilityLabel,
  noResultsText,
  testIDPrefix,
  onChangeText,
  onSelect,
}: LocationAutocompleteProps) {
  const colors = useColors();
  const inputRef = useRef<TextInput>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focused, setFocused] = useState(false);
  const results = useMemo(
    () => filterLocationOptions(options, value),
    [options, value],
  );
  const showResults = focused && value.trim().length > 0;

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  const cancelPendingBlur = () => {
    if (!blurTimerRef.current) return;
    clearTimeout(blurTimerRef.current);
    blurTimerRef.current = null;
  };

  const handleSelect = (option: LocationOption) => {
    cancelPendingBlur();
    onSelect(option);
    setFocused(false);
    inputRef.current?.blur();
  };

  return (
    <View style={styles.container}>
      <Input
        ref={inputRef}
        testID={`${testIDPrefix}-input`}
        accessibilityLabel={accessibilityLabel}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          cancelPendingBlur();
          setFocused(true);
        }}
        onBlur={() => {
          blurTimerRef.current = setTimeout(() => setFocused(false), 180);
        }}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        containerStyle={showResults ? styles.openInput : undefined}
      />

      {showResults && (
        <View
          testID={`${testIDPrefix}-results`}
          style={[
            styles.results,
            {
              backgroundColor: colors.popover,
              borderColor: colors.border,
            },
          ]}
        >
          {results.length > 0 ? results.map((option, index) => (
            <React.Fragment key={option.code}>
              <Pressable
                testID={`${testIDPrefix}-option-${option.code}`}
                accessibilityRole="button"
                accessibilityLabel={option.name}
                onPress={() => handleSelect(option)}
                style={({ pressed }) => [
                  styles.result,
                  pressed && { backgroundColor: colors.glassStrong },
                ]}
              >
                <Text style={[styles.resultText, { color: colors.popoverForeground }]}>
                  {option.name}
                </Text>
                {selectedCode === option.code && (
                  <Ionicons name="checkmark" size={18} color={colors.primary} />
                )}
              </Pressable>
              {index < results.length - 1 && (
                <View style={[styles.separator, { backgroundColor: colors.border }]} />
              )}
            </React.Fragment>
          )) : (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.emptyText, { color: colors.mutedForeground }]}
            >
              {noResultsText}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  openInput: {
    marginBottom: 8,
  },
  results: {
    borderWidth: 1,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  result: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  resultText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});