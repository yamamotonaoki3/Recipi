/**
 * ログイン画面（screens/login.md）。
 *
 * `useState` でフォームの入力値を持ち、送信ボタンで `useLogin`
 * （useMutation）を呼ぶ。成功したら**常にホーム（`/(app)`）へ遷移する**
 * （Issue #53。以前の「弾かれる前に行こうとしていた画面へ戻す」挙動は廃止）。
 */
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";

import { ApiError } from "@/features/auth/api";
import { useLogin } from "@/features/auth/useLogin";
import { PasswordField } from "@/components/PasswordField";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const login = useLogin();
  const router = useRouter();

  function handleSubmit() {
    setErrorMessage(null);
    login.mutate(
      { email, password, rememberMe },
      {
        onSuccess: () => {
          router.replace("/home");
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 401) {
            // メール/パスワードのどちらが誤りかは区別しない（enumeration 対策。auth.md）。
            setErrorMessage("メールアドレスまたはパスワードが違います");
          } else {
            setErrorMessage("通信エラー。もう一度お試しください");
          }
        },
      },
    );
  }

  return (
    <View className="flex-1 justify-center gap-4 bg-white p-6">
      <Text className="mb-2 text-2xl font-bold text-neutral-900">ログイン</Text>

      <TextInput
        testID="login-email"
        value={email}
        onChangeText={setEmail}
        placeholder="メールアドレス"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
      />

      <PasswordField
        testID="login-password"
        value={password}
        onChangeText={setPassword}
        placeholder="パスワード"
      />

      <View className="flex-row items-center gap-2">
        <Switch
          testID="login-remember-me"
          value={rememberMe}
          onValueChange={setRememberMe}
          accessibilityLabel="ログインを保持"
        />
        <Text className="text-neutral-700">ログインを保持</Text>
      </View>

      {errorMessage && <Text className="text-sm text-red-600">{errorMessage}</Text>}

      <Pressable
        testID="login-submit"
        onPress={handleSubmit}
        disabled={login.isPending}
        className="items-center rounded-lg bg-orange-500 py-3"
        accessibilityRole="button"
      >
        <Text className="font-semibold text-white">
          {login.isPending ? "ログイン中…" : "ログイン"}
        </Text>
      </Pressable>

      <Link href="/(auth)/password-reset" className="text-center text-sm text-neutral-600">
        パスワードをお忘れの方
      </Link>
      <Link href="/(auth)/signup" className="text-center text-sm text-neutral-600">
        新規登録
      </Link>
    </View>
  );
}
