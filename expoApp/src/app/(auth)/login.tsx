/**
 * ログイン画面（screens/login.md）。
 *
 * `useState` でフォームの入力値を持ち、送信ボタンで `useLogin`
 * （useMutation）を呼ぶ。成功したら**常にホーム（`/(app)`）へ遷移する**
 * （Issue #53。以前の「弾かれる前に行こうとしていた画面へ戻す」挙動は廃止）。
 */
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";

import { ApiError } from "@/features/auth/api";
import { useLogin, useReactivate } from "@/features/auth/useLogin";
import {
  hasFieldErrors,
  mapServerValidationErrors,
  validateLogin,
  type LoginFieldErrors,
} from "@/features/auth/validation";
import { PasswordField } from "@/components/PasswordField";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [confirmReactivate, setConfirmReactivate] = useState(false);

  const login = useLogin();
  const reactivate = useReactivate();
  const router = useRouter();

  // パスワード再設定の成功をスナックバーで知らせる（screens/password-reset.md §4）。
  // 再設定画面は `?reset=done` を付けてここへ移る。表示するかは開いた時点で決め、
  // 表示したらパラメータを消す（戻る・再マウントで出し直さないため）。数秒で自然に消す。
  const params = useLocalSearchParams<{ reset?: string }>();
  const [resetNotice, setResetNotice] = useState(() => params.reset === "done");

  useEffect(() => {
    if (!resetNotice) return;
    router.setParams({ reset: undefined });
    const timer = setTimeout(() => setResetNotice(false), 3000);
    return () => clearTimeout(timer);
  }, [resetNotice, router]);

  function handleSubmit() {
    setErrorMessage(null);
    const validationErrors = validateLogin({ email, password });
    setFieldErrors(validationErrors);
    if (hasFieldErrors(validationErrors)) return;
    login.mutate(
      { email, password, rememberMe },
      {
        onSuccess: () => {
          router.replace("/home");
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 400) {
            const mapped = mapServerValidationErrors(error.details, ["email", "password"]);
            setFieldErrors(mapped);
            if (mapped.form) setErrorMessage(mapped.form);
          } else if (error instanceof ApiError && error.code === "ACCOUNT_DEACTIVATED") {
            setConfirmReactivate(true);
          } else if (error instanceof ApiError && error.status === 401) {
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
        onChangeText={(value) => {
          setEmail(value);
          setFieldErrors((previous) => ({ ...previous, email: undefined, form: undefined }));
          setErrorMessage(null);
        }}
        placeholder="メールアドレス"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        accessibilityLabel="メールアドレス"
        className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
      />
      {fieldErrors.email && <Text className="text-sm text-red-600">{fieldErrors.email}</Text>}

      <PasswordField
        testID="login-password"
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          setFieldErrors((previous) => ({ ...previous, password: undefined, form: undefined }));
          setErrorMessage(null);
        }}
        placeholder="パスワード"
        errorMessage={fieldErrors.password}
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
      <Link href="/app-info" className="text-center text-sm text-neutral-600">
        アプリ情報
      </Link>

      {resetNotice && (
        <View
          testID="login-reset-success-snackbar"
          className="absolute inset-x-4 bottom-6 rounded-lg bg-neutral-800 px-4 py-3"
        >
          <Text className="text-sm text-white">パスワードを再設定しました</Text>
        </View>
      )}

      <ConfirmDialog
        visible={confirmReactivate}
        testID="account-reactivate-dialog"
        title="アカウントを再開しますか？"
        message="プロフィールとレシピを再開します。退会時に削除されたフォロー・お気に入り・感想・通知・閲覧履歴は戻りません。"
        confirmLabel={reactivate.isPending ? "再開中…" : "再開する"}
        destructive={false}
        onCancel={() => setConfirmReactivate(false)}
        onConfirm={() => {
          reactivate.mutate(
            { email, password, rememberMe },
            {
              onSuccess: () => {
                setConfirmReactivate(false);
                router.replace("/home");
              },
              onError: () => setErrorMessage("通信エラー。もう一度お試しください"),
            },
          );
        }}
      />
    </View>
  );
}
