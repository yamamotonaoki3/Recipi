/**
 * プロフィール編集画面（Issue #36 のスコープ: 表示名のみ）。
 *
 * 本来の profile-edit.md はアバター・SNS リンク等も含むが、
 * roadmap.md の Phase 1 スコープは「プロフィール編集（表示名のみ）」。
 * 残りの項目は Phase 5 以降で追加する。
 */
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { validateDisplayName } from "@/features/auth/validation";
import { useUpdateProfile } from "@/features/auth/useUpdateProfile";
import { useSession } from "@/store/session";

export default function ProfileEditScreen() {
  const user = useSession((s) => s.user);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // 保護ルートへの直接ディープリンク（cold start）では、この画面が
  // useAuthRefresh によるユーザー復元より先にマウントされることがあり、
  // その時点では user がまだ null。復元完了後に一度だけ反映する
  // （すでに入力を始めていたら上書きしない）。
  const hasEditedRef = useRef(false);
  useEffect(() => {
    if (user && !hasEditedRef.current) {
      setDisplayName(user.displayName);
    }
  }, [user]);

  const updateProfile = useUpdateProfile();
  const router = useRouter();

  function handleSave() {
    setErrorMessage(null);
    setSuccessMessage(null);
    const error = validateDisplayName(displayName);
    setFieldError(error);
    if (error) return;

    updateProfile.mutate(
      { displayName },
      {
        onSuccess: () => {
          setSuccessMessage("保存しました");
          router.back();
        },
        onError: () => {
          setErrorMessage("保存に失敗しました");
        },
      },
    );
  }

  return (
    <View className="flex-1 gap-4 bg-white p-6">
      <Text className="mb-2 text-2xl font-bold text-neutral-900">プロフィール編集</Text>

      <View>
        <TextInput
          testID="profile-edit-display-name"
          value={displayName}
          onChangeText={(text) => {
            hasEditedRef.current = true;
            setDisplayName(text);
          }}
          placeholder="表示名"
          className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
        />
        {fieldError && <Text className="mt-1 text-sm text-red-600">{fieldError}</Text>}
      </View>

      {errorMessage && <Text className="text-sm text-red-600">{errorMessage}</Text>}
      {successMessage && <Text className="text-sm text-green-700">{successMessage}</Text>}

      <Pressable
        testID="profile-edit-save"
        onPress={handleSave}
        disabled={updateProfile.isPending}
        className="items-center rounded-lg bg-orange-500 py-3"
        accessibilityRole="button"
      >
        <Text className="font-semibold text-white">
          {updateProfile.isPending ? "保存中…" : "保存"}
        </Text>
      </Pressable>
    </View>
  );
}
