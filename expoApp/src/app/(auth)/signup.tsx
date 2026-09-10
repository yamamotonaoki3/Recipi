/**
 * サインアップ画面（screens/signup.md）。
 *
 * 送信前にクライアント側で `validateSignup` を実行し、1つでもエラーが
 * あれば API を呼ばずにその場でエラー表示する
 * （グローバル CLAUDE.md の標準UI要件: パスワード確認欄の不一致は
 * クライアント側でブロックする）。
 */
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ApiError } from "@/features/auth/api";
import { useSignup } from "@/features/auth/useSignup";
import { validateSignup, type SignupFieldErrors } from "@/features/auth/validation";
import { PasswordField } from "@/components/PasswordField";

export default function SignupScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);

  const signup = useSignup();
  const router = useRouter();

  function handleSubmit() {
    setSubmitErrorMessage(null);
    const errors = validateSignup({
      email,
      password,
      passwordConfirm,
      displayName,
      securityQuestion,
      securityAnswer,
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    signup.mutate(
      { email, password, displayName, securityQuestion, securityAnswer },
      {
        onSuccess: () => {
          // サインアップ成功後は常にホームへ（Issue #53。login.tsx と同じ方針）。
          router.replace("/home");
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            setFieldErrors((prev) => ({
              ...prev,
              email: "このメールアドレスは登録済みです",
            }));
          } else {
            setSubmitErrorMessage("通信エラー。もう一度お試しください");
          }
        },
      },
    );
  }

  return (
    <ScrollView contentContainerClassName="gap-4 bg-white p-6">
      <Text className="mb-2 text-2xl font-bold text-neutral-900">新規登録</Text>

      <View>
        <TextInput
          testID="signup-email"
          value={email}
          onChangeText={setEmail}
          placeholder="メールアドレス"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
        />
        {fieldErrors.email && (
          <Text className="mt-1 text-sm text-red-600">{fieldErrors.email}</Text>
        )}
      </View>

      <PasswordField
        testID="signup-password"
        value={password}
        onChangeText={setPassword}
        placeholder="パスワード"
        errorMessage={fieldErrors.password}
      />

      <PasswordField
        testID="signup-password-confirm"
        value={passwordConfirm}
        onChangeText={setPasswordConfirm}
        placeholder="パスワード（確認）"
        errorMessage={fieldErrors.passwordConfirm}
      />

      <View>
        <TextInput
          testID="signup-display-name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="表示名"
          className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
        />
        {fieldErrors.displayName && (
          <Text className="mt-1 text-sm text-red-600">{fieldErrors.displayName}</Text>
        )}
      </View>

      <View>
        <TextInput
          testID="signup-security-question"
          value={securityQuestion}
          onChangeText={setSecurityQuestion}
          placeholder="秘密の質問（例: 好きな食べ物は？）"
          className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
        />
        <Text className="mt-1 text-xs text-neutral-500">
          パスワードを忘れたときの本人確認に使います。
        </Text>
        {fieldErrors.securityQuestion && (
          <Text className="mt-1 text-sm text-red-600">{fieldErrors.securityQuestion}</Text>
        )}
      </View>

      <View>
        <TextInput
          testID="signup-security-answer"
          value={securityAnswer}
          onChangeText={setSecurityAnswer}
          placeholder="秘密の質問の答え"
          className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
        />
        {fieldErrors.securityAnswer && (
          <Text className="mt-1 text-sm text-red-600">{fieldErrors.securityAnswer}</Text>
        )}
      </View>

      {submitErrorMessage && <Text className="text-sm text-red-600">{submitErrorMessage}</Text>}

      <Pressable
        testID="signup-submit"
        onPress={handleSubmit}
        disabled={signup.isPending}
        className="items-center rounded-lg bg-orange-500 py-3"
        accessibilityRole="button"
      >
        <Text className="font-semibold text-white">{signup.isPending ? "登録中…" : "登録"}</Text>
      </Pressable>

      <Link href="/(auth)/login" className="text-center text-sm text-neutral-600">
        ログインへ
      </Link>
    </ScrollView>
  );
}
