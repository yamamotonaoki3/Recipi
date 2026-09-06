/**
 * パスワード入力欄（表示/非表示トグル付き）。
 *
 * グローバル CLAUDE.md「ログイン機能の標準UI要件」で、パスワード入力欄には
 * 必ず表示トグルボタンを併設することが決まっている。ログイン・サインアップ・
 * パスワードリセットの全画面で共通して使う部品としてここに切り出す。
 *
 * `useState` で「今、平文表示にしているか」だけを持つシンプルな作り。
 */
import { useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

type PasswordFieldProps = Omit<TextInputProps, "secureTextEntry"> & {
  errorMessage?: string;
};

export function PasswordField({
  errorMessage,
  className,
  testID,
  ...textInputProps
}: PasswordFieldProps) {
  // true の間は平文表示（secureTextEntry を外す）。
  const [isVisible, setIsVisible] = useState(false);

  return (
    <View>
      <View className="flex-row items-center rounded-lg border border-neutral-300 px-3">
        <TextInput
          {...textInputProps}
          testID={testID}
          secureTextEntry={!isVisible}
          autoCapitalize="none"
          autoCorrect={false}
          className={`flex-1 py-3 text-base text-neutral-900 ${className ?? ""}`}
        />
        <Pressable
          onPress={() => setIsVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={isVisible ? "パスワードを非表示にする" : "パスワードを表示する"}
          testID={testID ? `${testID}-toggle` : undefined}
          hitSlop={8}
        >
          <Text className="px-2 text-sm text-neutral-500">{isVisible ? "隠す" : "表示"}</Text>
        </Pressable>
      </View>
      {errorMessage && <Text className="mt-1 text-sm text-red-600">{errorMessage}</Text>}
    </View>
  );
}
