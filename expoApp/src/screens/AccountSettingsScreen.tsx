/**
 * アカウント設定画面（Issue #242）。マイページから開く。
 *
 * 「現在のパスワードで再認証してから認証情報を変える」操作をまとめる画面。
 * 表示名・自己紹介など他人への見せ方を変える `ProfileEditScreen` とは性質が違うので分ける。
 * 今は秘密の質問の変更だけ。メールアドレスの変更（#243）もここに足す。
 */
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackLabel } from "@/components/BackLabel";
import { PasswordField } from "@/components/PasswordField";
import { useChangeSecurityQuestion } from "@/features/account/hooks";
import {
  type SecurityQuestionFieldErrors,
  validateSecurityQuestionForm,
} from "@/features/account/validation";
import { ApiError } from "@/features/auth/api";
import { hasFieldErrors } from "@/features/auth/validation";

const FALLBACK_PATH = "/my-page";

/** サーバーのエラーを、画面に出す文言と「どの欄に出すか」に振り分ける。 */
function describeError(error: unknown): { field?: "currentPassword"; message: string } {
  if (error instanceof ApiError) {
    // 現在のパスワード違いは 403 REAUTH_FAILED（401 ではない）。欄の下に出す。
    if (error.status === 403 && error.code === "REAUTH_FAILED") {
      return { field: "currentPassword", message: "現在のパスワードが正しくありません" };
    }
    if (error.status === 429) {
      return { message: "試行回数が上限に達しました。しばらくしてからお試しください" };
    }
    if (error.status === 400) return { message: "入力内容を確認してください" };
  }
  return { message: "通信エラー。もう一度お試しください" };
}

export function AccountSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace(FALLBACK_PATH as never);
  }

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 border-b border-neutral-200 px-4 py-3">
        <Pressable testID="account-settings-back" onPress={leave} accessibilityRole="button">
          <BackLabel />
        </Pressable>
        <Text className="text-base font-bold text-neutral-900">アカウント設定</Text>
      </View>
      <ScrollView contentContainerClassName="gap-8 p-6">
        <SecurityQuestionSection />
      </ScrollView>
    </View>
  );
}

function SecurityQuestionSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [securityAnswerConfirm, setSecurityAnswerConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SecurityQuestionFieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const change = useChangeSecurityQuestion();

  function handleSubmit() {
    setErrorMessage(null);
    setSucceeded(false);
    const errors = validateSecurityQuestionForm({
      currentPassword,
      securityQuestion,
      securityAnswer,
      securityAnswerConfirm,
    });
    setFieldErrors(errors);
    // 確認の不一致などはここで止め、API を呼ばない。
    if (hasFieldErrors(errors)) return;

    change.mutate(
      { currentPassword, securityQuestion, securityAnswer },
      {
        onSuccess: () => {
          // パスワードと答えを画面に残さない。
          setCurrentPassword("");
          setSecurityQuestion("");
          setSecurityAnswer("");
          setSecurityAnswerConfirm("");
          setSucceeded(true);
        },
        onError: (error) => {
          const described = describeError(error);
          if (described.field) setFieldErrors({ [described.field]: described.message });
          else setErrorMessage(described.message);
        },
      },
    );
  }

  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text className="text-lg font-bold text-neutral-900">秘密の質問</Text>
        <Text className="text-sm text-neutral-600">
          パスワードを忘れたときの本人確認に使います。変更するには現在のパスワードが必要です。
        </Text>
      </View>

      <View className="gap-1">
        <Text className="text-sm text-neutral-700">現在のパスワード</Text>
        <PasswordField
          testID="account-settings-current-password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          errorMessage={fieldErrors.currentPassword}
        />
      </View>

      <View className="gap-1">
        <Text className="text-sm text-neutral-700">新しい質問</Text>
        <TextInput
          testID="account-settings-security-question"
          value={securityQuestion}
          onChangeText={setSecurityQuestion}
          className="rounded-lg border border-neutral-300 px-3 py-3 text-base text-neutral-900"
        />
        {fieldErrors.securityQuestion && (
          <Text className="text-sm text-red-600">{fieldErrors.securityQuestion}</Text>
        )}
      </View>

      <View className="gap-1">
        <Text className="text-sm text-neutral-700">新しい答え</Text>
        <PasswordField
          testID="account-settings-security-answer"
          toggleSubject="答え"
          value={securityAnswer}
          onChangeText={setSecurityAnswer}
          errorMessage={fieldErrors.securityAnswer}
        />
      </View>

      <View className="gap-1">
        <Text className="text-sm text-neutral-700">新しい答え（確認）</Text>
        <PasswordField
          testID="account-settings-security-answer-confirm"
          toggleSubject="答え"
          value={securityAnswerConfirm}
          onChangeText={setSecurityAnswerConfirm}
          errorMessage={fieldErrors.securityAnswerConfirm}
        />
      </View>

      {errorMessage && (
        <Text testID="account-settings-error" className="text-sm text-red-600">
          {errorMessage}
        </Text>
      )}
      {succeeded && (
        <Text testID="account-settings-success" className="text-sm text-green-700">
          秘密の質問を変更しました
        </Text>
      )}

      <Pressable
        testID="account-settings-security-submit"
        onPress={handleSubmit}
        disabled={change.isPending}
        accessibilityRole="button"
        accessibilityState={{ disabled: change.isPending }}
        className={`items-center rounded-lg py-3 ${change.isPending ? "bg-neutral-300" : "bg-orange-500"}`}
      >
        <Text className="font-semibold text-white">
          {change.isPending ? "変更中…" : "秘密の質問を変更する"}
        </Text>
      </Pressable>
    </View>
  );
}
