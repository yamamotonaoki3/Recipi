/**
 * パスワードリセット画面（screens/password-reset.md）。
 *
 * 1画面2ステップ:
 * - ステップ1: メールアドレスを送って秘密の質問を取得する
 * - ステップ2: 答え + 新パスワード + 確認入力をまとめて送る
 *   （答えだけを検証する中間エンドポイントは無い）
 */
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ApiError } from "@/features/auth/api";
import { useConfirmPasswordReset, useRequestPasswordReset } from "@/features/auth/usePasswordReset";
import {
  validatePasswordResetConfirm,
  type PasswordResetConfirmFieldErrors,
} from "@/features/auth/validation";
import { PasswordField } from "@/components/PasswordField";

export default function PasswordResetScreen() {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<PasswordResetConfirmFieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const requestReset = useRequestPasswordReset();
  const confirmReset = useConfirmPasswordReset();
  const router = useRouter();

  function handleRequestSubmit() {
    setErrorMessage(null);
    requestReset.mutate(
      { email },
      {
        onSuccess: (data) => {
          setSecurityQuestion(data.securityQuestion);
          setStep(2);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 404) {
            setErrorMessage("このメールアドレスは登録されていません");
          } else {
            setErrorMessage("通信エラー。もう一度お試しください");
          }
        },
      },
    );
  }

  function handleConfirmSubmit() {
    setErrorMessage(null);
    const errors = validatePasswordResetConfirm({
      securityAnswer,
      newPassword,
      newPasswordConfirm,
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    confirmReset.mutate(
      { email, securityAnswer, newPassword },
      {
        onSuccess: () => {
          setSuccessMessage("パスワードを再設定しました");
          router.replace("/(auth)/login");
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 429) {
            setErrorMessage("試行回数が上限に達しました。しばらくしてからお試しください");
          } else {
            // 未登録メール・答え不一致・パスワード規則違反は区別しない（オラクル攻撃対策）。
            setErrorMessage("入力内容を確認してください");
          }
        },
      },
    );
  }

  return (
    <ScrollView contentContainerClassName="gap-4 bg-white p-6">
      <Text className="mb-2 text-2xl font-bold text-neutral-900">パスワードの再設定</Text>

      <TextInput
        testID="password-reset-email"
        value={email}
        onChangeText={setEmail}
        editable={step === 1}
        placeholder="メールアドレス"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
      />

      {step === 1 && (
        <Pressable
          testID="password-reset-request-submit"
          onPress={handleRequestSubmit}
          disabled={requestReset.isPending}
          className="items-center rounded-lg bg-orange-500 py-3"
          accessibilityRole="button"
        >
          <Text className="font-semibold text-white">
            {requestReset.isPending ? "確認中…" : "質問を表示"}
          </Text>
        </Pressable>
      )}

      {step === 2 && (
        <>
          <Text className="rounded-lg bg-neutral-100 p-3 text-neutral-800">{securityQuestion}</Text>

          <View>
            <TextInput
              testID="password-reset-security-answer"
              value={securityAnswer}
              onChangeText={setSecurityAnswer}
              placeholder="答え"
              className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
            />
            {fieldErrors.securityAnswer && (
              <Text className="mt-1 text-sm text-red-600">{fieldErrors.securityAnswer}</Text>
            )}
          </View>

          <PasswordField
            testID="password-reset-new-password"
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="新しいパスワード"
            errorMessage={fieldErrors.newPassword}
          />

          <PasswordField
            testID="password-reset-new-password-confirm"
            value={newPasswordConfirm}
            onChangeText={setNewPasswordConfirm}
            placeholder="新しいパスワード（確認）"
            errorMessage={fieldErrors.newPasswordConfirm}
          />

          <Pressable
            testID="password-reset-confirm-submit"
            onPress={handleConfirmSubmit}
            disabled={confirmReset.isPending}
            className="items-center rounded-lg bg-orange-500 py-3"
            accessibilityRole="button"
          >
            <Text className="font-semibold text-white">
              {confirmReset.isPending ? "送信中…" : "パスワードを再設定"}
            </Text>
          </Pressable>
        </>
      )}

      {errorMessage && <Text className="text-sm text-red-600">{errorMessage}</Text>}
      {successMessage && <Text className="text-sm text-green-700">{successMessage}</Text>}

      <Link href="/(auth)/login" className="text-center text-sm text-neutral-600">
        ログインへ
      </Link>
    </ScrollView>
  );
}
