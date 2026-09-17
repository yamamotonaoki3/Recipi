import { Pressable, Text, View } from "react-native";

import type { ProofreadSuggestion } from "./proofread";

export function ProofreadPanel({
  suggestions,
  onApply,
  onIgnore,
  onApplyAll,
  onIgnoreAll,
}: {
  suggestions: ProofreadSuggestion[];
  onApply: (suggestion: ProofreadSuggestion) => void;
  onIgnore: (suggestion: ProofreadSuggestion) => void;
  onApplyAll: () => void;
  onIgnoreAll: () => void;
}) {
  if (suggestions.length === 0) {
    return (
      <Text testID="proofread-empty" className="text-sm text-neutral-600">
        誤字は見つかりませんでした
      </Text>
    );
  }

  return (
    <View
      testID="proofread-panel"
      className="gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3"
    >
      <Text className="font-semibold text-neutral-900">修正案</Text>
      {suggestions.map((suggestion) => (
        <View
          key={suggestion.id}
          testID={`proofread-suggestion-${suggestion.id}`}
          className="gap-1 rounded border border-orange-100 bg-white p-2"
        >
          <Text className="text-sm text-neutral-700">
            {suggestion.original} → {suggestion.corrected}
          </Text>
          {suggestion.note && <Text className="text-xs text-neutral-500">{suggestion.note}</Text>}
          <View className="flex-row gap-2">
            <Pressable
              testID={`proofread-apply-${suggestion.id}`}
              onPress={() => onApply(suggestion)}
              accessibilityRole="button"
              className="rounded bg-orange-500 px-3 py-1"
            >
              <Text className="text-sm text-white">適用</Text>
            </Pressable>
            <Pressable
              testID={`proofread-ignore-${suggestion.id}`}
              onPress={() => onIgnore(suggestion)}
              accessibilityRole="button"
              className="rounded border border-neutral-300 px-3 py-1"
            >
              <Text className="text-sm text-neutral-700">無視</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <View className="flex-row gap-2">
        <Pressable
          testID="proofread-apply-all"
          onPress={onApplyAll}
          accessibilityRole="button"
          className="rounded bg-orange-600 px-3 py-2"
        >
          <Text className="text-sm text-white">すべて適用</Text>
        </Pressable>
        <Pressable
          testID="proofread-ignore-all"
          onPress={onIgnoreAll}
          accessibilityRole="button"
          className="rounded border border-neutral-300 px-3 py-2"
        >
          <Text className="text-sm text-neutral-700">すべて無視</Text>
        </Pressable>
      </View>
    </View>
  );
}
