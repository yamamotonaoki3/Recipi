/**
 * プロフィール編集画面（screens/profile-edit.md・features/profile.md。Issue #94）。
 *
 * 上から: アバター（変更 / 削除）→ 表示名 → メール（表示 ＋ 公開トグル）→
 * X / Instagram / その他の URL（＋ 公開トグル）。アプリバー右の「保存」で
 * **変更した項目だけ** `PATCH /users/me` を送る。
 *
 * アバターは「保存」と独立して、選んだ時点でサーバーに保存される
 * （profile-edit.md §5「即時反映」）。そのため未保存の変更の判定にも含めない。
 *
 * アカウント削除ボタン（区切り線の下）は F7 で追加する。
 */
import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ApiError } from "@/features/auth/api";
import type { UserSelfProfile } from "@/features/profile/api";
import {
  useAvatarUpload,
  useDeleteAvatar,
  useMyProfile,
  useUpdateProfile,
} from "@/features/profile/hooks";
import {
  buildPatch,
  fromProfile,
  isDirty,
  mapServerErrors,
  validateProfileForm,
  type ProfileFieldErrors,
  type ProfileFormValues,
} from "@/features/profile/profileForm";
import { useUnsavedChangesStore } from "@/features/navigation/unsavedChanges";
import { useUnsavedChangesGuard } from "@/features/recipe/useUnsavedChangesGuard";

/** アバター設定完了の通知を出しておく時間（ミリ秒）。 */
export const AVATAR_TOAST_MS = 2000;

/** ディープリンクで直接開かれて戻り先が無いときの行き先（lessons #38-7）。 */
const FALLBACK_PATH = "/my-page";

export function ProfileEditScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profileQuery = useMyProfile();

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace(FALLBACK_PATH as never);
  }

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {profileQuery.data &&
      (profileQuery.isFetchedAfterMount || !profileQuery.isFetching || profileQuery.isError) ? (
        // フォームは取得できた値で 1 回だけ初期化したいので、取得後に
        // 別コンポーネントとしてマウントする（effect で setState しなくて済む）。
        <ProfileEditForm profile={profileQuery.data} onLeave={leave} />
      ) : (
        <>
          <AppBar onBack={leave} />
          {profileQuery.missingUser ? (
            <View className="flex-1 items-center justify-center p-6">
              <Text className="text-center text-neutral-600">
                読み込みに失敗しました。ログインし直してください。
              </Text>
            </View>
          ) : profileQuery.isError ? (
            <View className="flex-1 items-center justify-center gap-3 p-6">
              <Text className="text-neutral-600">読み込みに失敗しました</Text>
              <Pressable
                testID="profile-edit-retry"
                onPress={() => void profileQuery.refetch()}
                accessibilityRole="button"
                className="rounded-lg border border-neutral-300 px-4 py-2"
              >
                <Text className="text-neutral-700">再試行</Text>
              </Pressable>
            </View>
          ) : (
            <Skeleton />
          )}
        </>
      )}
    </View>
  );
}

/** アプリバー（戻る ＋ タイトル ＋ 右に保存）。 */
function AppBar({
  onBack,
  onSave,
  saving = false,
}: {
  onBack: () => void;
  onSave?: () => void;
  saving?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3">
      <Pressable testID="profile-edit-back" onPress={onBack} accessibilityRole="button">
        <Text className="text-neutral-500">← 戻る</Text>
      </Pressable>
      <Text className="text-base font-bold text-neutral-900">プロフィール編集</Text>
      <Pressable
        testID="profile-edit-save"
        onPress={onSave}
        disabled={!onSave || saving}
        accessibilityRole="button"
      >
        <Text className={onSave && !saving ? "font-semibold text-orange-600" : "text-neutral-400"}>
          {saving ? "保存中…" : "保存"}
        </Text>
      </Pressable>
    </View>
  );
}

/** 読み込み中の見た目（各欄の形だけを灰色で出す）。 */
function Skeleton() {
  return (
    <View testID="profile-edit-skeleton" className="gap-4 p-6">
      <View className="h-20 w-20 rounded-full bg-neutral-100" />
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} className="h-11 rounded-lg bg-neutral-100" />
      ))}
    </View>
  );
}

type UrlField = "xUrl" | "instagramUrl" | "otherUrl";
type ToggleField = "emailPublic" | "xPublic" | "instagramPublic" | "otherPublic";

/** URL 欄の並びと表示用の情報。 */
const URL_ROWS: { field: UrlField; toggle: ToggleField; label: string; testID: string }[] = [
  { field: "xUrl", toggle: "xPublic", label: "X の URL", testID: "profile-edit-x" },
  {
    field: "instagramUrl",
    toggle: "instagramPublic",
    label: "Instagram の URL",
    testID: "profile-edit-instagram",
  },
  { field: "otherUrl", toggle: "otherPublic", label: "その他の URL", testID: "profile-edit-other" },
];

function ProfileEditForm({ profile, onLeave }: { profile: UserSelfProfile; onLeave: () => void }) {
  // 初期値は最初に受け取った値で固定する。保存後に画面を離れるので、
  // 再取得で初期値が変わっても入力中の内容を上書きしない。
  const [initial] = useState<ProfileFormValues>(() => fromProfile(profile));
  const [values, setValues] = useState<ProfileFormValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateProfile = useUpdateProfile();
  const saving = updateProfile.isPending;
  const dirty = isDirty(initial, values);
  const guard = useUnsavedChangesGuard(dirty, onLeave, saving);

  useEffect(() => {
    if (!dirty) return;

    // タブをもう一度押したときも、画面内の戻るボタンと同じ確認を出す。
    // 保存中は guard.requestClose 自身が何もしないため、入力内容を守ったまま待つ。
    useUnsavedChangesStore.getState().registerRequestClose(guard.requestClose);
    return () => useUnsavedChangesStore.getState().clearRequestClose(guard.requestClose);
  }, [dirty, guard.requestClose]);

  function setField<K extends keyof ProfileFormValues>(field: K, value: ProfileFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
    // 直した欄のエラーはその場で消す（他の欄のエラーは残す）。
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSave() {
    // 前回の確認ダイアログが残っていても、保存開始時は閉じておく。
    guard.cancelLeave();
    setErrorMessage(null);
    const errors = validateProfileForm(values);
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    const patch = buildPatch(initial, values);
    // 何も変わっていなければ送る必要はない。
    if (Object.keys(patch).length === 0) {
      onLeave();
      return;
    }

    updateProfile.mutate(patch, {
      onSuccess: onLeave,
      onError: (error) => {
        // サーバーの 400 は、分かる欄にはその欄の下に出す。
        const serverErrors =
          error instanceof ApiError && error.status === 400 ? mapServerErrors(error.details) : {};
        if (Object.keys(serverErrors).length > 0) {
          setFieldErrors(serverErrors);
        } else {
          setErrorMessage("保存に失敗しました");
        }
      },
    });
  }

  return (
    <>
      {/* 未保存の変更がある間は iOS のスワイプバックを無効にする。
          スワイプで閉じると requestClose を通らず、確認ダイアログが出ないため。
          Android の戻るボタンは useUnsavedChangesGuard が処理する。 */}
      <Stack.Screen options={{ gestureEnabled: !dirty && !saving }} />

      <AppBar onBack={guard.requestClose} onSave={handleSave} saving={saving} />

      <ScrollView contentContainerClassName="gap-5 p-6">
        {/* `profile` は親の取得結果そのもの。アバターの設定 / 削除でキャッシュが
            書き換わると、ここにも新しい avatarUrl が届く（フォームの初期値とは別）。 */}
        <AvatarSection
          avatarUrl={profile.avatarUrl}
          displayName={values.displayName || profile.displayName}
        />

        <View className="gap-1">
          <Text className="text-xs text-neutral-500">表示名</Text>
          <TextInput
            testID="profile-edit-display-name"
            value={values.displayName}
            onChangeText={(text) => setField("displayName", text)}
            editable={!saving}
            placeholder="表示名"
            className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
          />
          {fieldErrors.displayName && (
            <Text testID="profile-edit-display-name-error" className="text-sm text-red-600">
              {fieldErrors.displayName}
            </Text>
          )}
        </View>

        <View className="gap-1">
          <Text className="text-xs text-neutral-500">メールアドレス</Text>
          <Text testID="profile-edit-email" className="text-base text-neutral-800">
            {profile.email}
          </Text>
          <PublicToggle
            testID="profile-edit-email-public"
            value={values.emailPublic}
            onChange={(v) => setField("emailPublic", v)}
            disabled={saving}
          />
        </View>

        {URL_ROWS.map((row) => (
          <View key={row.field} className="gap-1">
            <Text className="text-xs text-neutral-500">{row.label}</Text>
            <TextInput
              testID={`${row.testID}-url`}
              value={values[row.field]}
              onChangeText={(text) => setField(row.field, text)}
              editable={!saving}
              placeholder="https://"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
            />
            {fieldErrors[row.field] && (
              <Text testID={`${row.testID}-url-error`} className="text-sm text-red-600">
                {fieldErrors[row.field]}
              </Text>
            )}
            <PublicToggle
              testID={`${row.testID}-public`}
              value={values[row.toggle]}
              onChange={(v) => setField(row.toggle, v)}
              disabled={saving}
            />
          </View>
        ))}

        {errorMessage && (
          <Text testID="profile-edit-error" className="text-sm text-red-600">
            {errorMessage}
          </Text>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={guard.confirmVisible && !saving}
        title="変更を破棄しますか？"
        message="保存していない変更は失われます。"
        confirmLabel="破棄する"
        onConfirm={guard.confirmLeave}
        onCancel={guard.cancelLeave}
        testID="profile-edit-discard"
      />
    </>
  );
}

/** 「プロフィールに表示する」トグル。既定はすべて OFF（非公開）。 */
function PublicToggle({
  testID,
  value,
  onChange,
  disabled = false,
}: {
  testID: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-sm text-neutral-600">プロフィールに表示する</Text>
      <Switch testID={testID} value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

/**
 * アバターの設定 / 削除。選んだ時点でサーバーに保存する。
 *
 * 選択中とアップロード中の扱いはレシピ画像の ImagePickerField と同じ
 * （選択中も「変更」は押せる＝選択画面から戻れないときの逃げ道。
 * 削除は選択中・送信中は押せない＝あとから返った結果で復活させないため）。
 */
// ここで useMyProfile を呼び直さないこと。新しい購読者がマウントされるたびに
// プロフィールの再取得が 1 回余計に走る（値は親から受け取る）。
function AvatarSection({
  avatarUrl,
  displayName,
}: {
  avatarUrl: string | null;
  displayName: string;
}) {
  const upload = useAvatarUpload();
  const remove = useDeleteAvatar();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const isUploading = upload.status === "uploading";
  const isPicking = upload.status === "picking";
  const busy = isUploading || isPicking || remove.isPending;

  // 設定完了の通知。一定時間で自動的に消す。
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), AVATAR_TOAST_MS);
  }

  async function handlePick(source: "library" | "camera") {
    setRemoveError(null);
    const url = await upload.pickAndSend(source);
    if (url) showToast("アバターを設定しました");
  }

  function handleRemove() {
    if (busy) return;
    upload.clearError();
    setRemoveError(null);
    remove.mutate(undefined, {
      onSuccess: () => showToast("アバターを削除しました"),
      onError: () => setRemoveError("アバターの削除に失敗しました"),
    });
  }

  return (
    <View className="items-center gap-2">
      <View className="h-20 w-20 items-center justify-center">
        {isUploading ? (
          <ActivityIndicator testID="profile-edit-avatar-spinner" />
        ) : (
          <Avatar
            url={avatarUrl}
            displayName={displayName}
            size={80}
            testID="profile-edit-avatar"
          />
        )}
      </View>

      <View className="flex-row gap-4">
        <Pressable
          testID="profile-edit-avatar-pick"
          onPress={() => void handlePick("library")}
          disabled={isUploading || remove.isPending}
          accessibilityRole="button"
        >
          <Text className={isUploading ? "text-sm text-neutral-400" : "text-sm text-blue-600"}>
            {isPicking ? "画像を選び直す" : "変更"}
          </Text>
        </Pressable>
        {Platform.OS !== "web" && (
          // web はカメラ指定でもファイル選択になるので、撮影はモバイルだけ。
          <Pressable
            testID="profile-edit-avatar-camera"
            onPress={() => void handlePick("camera")}
            disabled={isUploading || remove.isPending}
            accessibilityRole="button"
          >
            <Text className="text-sm text-blue-600">写真を撮る</Text>
          </Pressable>
        )}
        {avatarUrl && (
          <Pressable
            testID="profile-edit-avatar-remove"
            onPress={handleRemove}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text className={busy ? "text-sm text-neutral-400" : "text-sm text-red-600"}>削除</Text>
          </Pressable>
        )}
      </View>

      {isPicking && (
        <Text className="text-xs text-neutral-500">
          画像を選んでいます。選択画面が開かないときは、もう一度押してください。
        </Text>
      )}
      {(upload.error ?? removeError) && (
        <Text testID="profile-edit-avatar-error" className="text-sm text-red-600">
          {upload.error ?? removeError}
        </Text>
      )}
      {toast && (
        <Text testID="profile-edit-avatar-toast" className="text-xs text-green-700">
          {toast}
        </Text>
      )}
    </View>
  );
}
