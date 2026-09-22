/**
 * 更新通知・backend接続不能警告をまとめて扱うルートレイアウト用ゲート（Issue #318）。
 *
 * `src/app/_layout.tsx`（未ログイン画面も含め常にマウントされる場所。
 * `OfflineBanner`と同じ）に置く。backend接続不能はログイン試行自体を
 * 失敗させるため、未ログインの利用者にこそ警告が必要
 * （`(app)/_layout.tsx`は認証済み時しかマウントされないため使わない）。
 */
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { checkForUpdate } from "./api";
import { useBackendReachability } from "./backendReachability";
import { getLatestReleaseUrl } from "./config";
import { startInstall } from "./installer";
import { openReleasePage } from "./openExternal";
import type { ReleaseInfo } from "./types";
import { useUpdateDismissal } from "./updateDismissal";
import { useHealth } from "@/api/health";
import { ConnectivityWarningDialog } from "@/components/ConnectivityWarningDialog";
import { InstallGuideDialog } from "@/components/InstallGuideDialog";
import { UpdateNotificationBanner } from "@/components/UpdateNotificationBanner";

export function AppUpdateGate() {
  const status = useBackendReachability((s) => s.status);
  const dismissedVersion = useUpdateDismissal((s) => s.dismissedVersion);
  const dismiss = useUpdateDismissal((s) => s.dismiss);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  // ダイアログを「後で確認」で閉じても、接続不能状態が続く間はバーで示す
  // （API復旧〈statusがokに戻る〉でリセットする）。useEffectではなく
  // レンダー中に前回値と比較して調整する（React公式が推奨するパターン。
  // useEffect内でのsetStateはcascading renderを招くため避ける）。
  const [dialogDismissed, setDialogDismissed] = useState(false);
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "ok") setDialogDismissed(false);
  }
  const health = useHealth();
  const [installGuideVisible, setInstallGuideVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate().then((result) => {
      if (!cancelled && result.state === "updateAvailable" && result.release) {
        setRelease(result.release);
      }
    });
    return () => {
      cancelled = true;
    };
    // 起動時に1回だけ確認する。
  }, []);

  function handleCheckUpdateFromDialog() {
    void checkForUpdate().then((result) => {
      if (result.state === "updateAvailable" && result.release) setRelease(result.release);
    });
  }

  const showUpdateBanner = release !== null && release.version !== dismissedVersion;

  return (
    <>
      {showUpdateBanner && release && (
        <UpdateNotificationBanner
          release={release}
          onUpdate={() => setInstallGuideVisible(true)}
          onDismiss={() => dismiss(release.version)}
          onViewRelease={() => void openReleasePage(release.bodyUrl || getLatestReleaseUrl())}
        />
      )}

      {release && (
        <InstallGuideDialog
          visible={installGuideVisible}
          onConfirm={() => startInstall(release)}
          onClose={() => setInstallGuideVisible(false)}
        />
      )}

      <ConnectivityWarningDialog
        visible={status === "unreachable" && !dialogDismissed}
        retrying={health.isFetching}
        onRetry={() => void health.refetch()}
        onCheckUpdate={handleCheckUpdateFromDialog}
        onDismiss={() => setDialogDismissed(true)}
      />

      {status === "unreachable" && dialogDismissed && (
        <View testID="connectivity-warning-bar" className="bg-red-700 px-4 py-2">
          <Text className="text-center text-sm text-white">
            サーバーに接続できません。データ操作ができない場合があります
          </Text>
        </View>
      )}
    </>
  );
}
