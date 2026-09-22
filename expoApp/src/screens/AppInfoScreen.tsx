/**
 * アプリ情報画面（Issue #317）。
 *
 * 現在のバージョンとGitHub Releaseへの導線を出すだけの画面。ログイン画面
 * からも開けるため、認証状態・セッションに依存せず単独で動作する
 * （バックエンド停止中・未ログインでも表示できる。features/update.md 参照）。
 */
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackLabel } from "@/components/BackLabel";
import { checkForUpdate } from "@/features/appUpdate/api";
import { getCurrentAppVersion, getLatestReleaseUrl } from "@/features/appUpdate/config";
import { openReleasePage } from "@/features/appUpdate/openExternal";
import type { UpdateState } from "@/features/appUpdate/types";

const FALLBACK_PATH = "/(auth)/login";

const UPDATE_STATE_LABEL: Record<UpdateState, string> = {
  idle: "",
  checking: "確認中…",
  upToDate: "最新版です",
  updateAvailable: "新しいバージョンがあります",
  checkFailed: "確認できませんでした",
};

export function AppInfoScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [version, setVersion] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCurrentAppVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace(FALLBACK_PATH as never);
  }

  async function handleOpenRelease() {
    setOpenError(false);
    setOpening(true);
    const result = await openReleasePage(getLatestReleaseUrl());
    setOpening(false);
    if (!result.ok) setOpenError(true);
  }

  async function handleCheckUpdate() {
    setUpdateState("checking");
    const result = await checkForUpdate();
    setUpdateState(result.state);
    setLatestVersion(result.release?.version ?? null);
  }

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 border-b border-neutral-200 px-4 py-3">
        <Pressable testID="app-info-back" onPress={leave} accessibilityRole="button">
          <BackLabel />
        </Pressable>
        <Text className="text-base font-bold text-neutral-900">アプリ情報</Text>
      </View>
      <ScrollView contentContainerClassName="gap-6 p-6">
        <View className="gap-1">
          <Text className="text-xl font-bold text-neutral-900">Recipi</Text>
          <Text testID="app-info-version" className="text-sm text-neutral-600">
            {version === null ? "バージョンを確認中…" : `バージョン ${version}`}
          </Text>
        </View>

        <View className="gap-1">
          <Pressable
            testID="app-info-check-update"
            onPress={() => void handleCheckUpdate()}
            disabled={updateState === "checking"}
            accessibilityRole="button"
            accessibilityState={{ disabled: updateState === "checking" }}
            className="items-center rounded-lg border border-neutral-300 py-3"
          >
            <Text className="font-semibold text-neutral-700">
              {updateState === "checking" ? "確認中…" : "更新を確認"}
            </Text>
          </Pressable>
          {updateState !== "idle" && updateState !== "checking" && (
            <Text testID="app-info-update-state" className="text-sm text-neutral-600">
              {UPDATE_STATE_LABEL[updateState]}
              {updateState === "updateAvailable" && latestVersion ? `（v${latestVersion}）` : ""}
            </Text>
          )}
        </View>

        <Pressable
          testID="app-info-view-release"
          onPress={() => void handleOpenRelease()}
          disabled={opening}
          accessibilityRole="button"
          className="items-center rounded-lg bg-orange-500 py-3"
        >
          <Text className="font-semibold text-white">
            {opening ? "開いています…" : "リリース内容を見る"}
          </Text>
        </Pressable>
        {openError && (
          <Text testID="app-info-open-error" className="text-sm text-red-600">
            開けませんでした。もう一度お試しください
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
