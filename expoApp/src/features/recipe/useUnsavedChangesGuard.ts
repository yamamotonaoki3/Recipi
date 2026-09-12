/**
 * 「未保存の変更がある状態で画面を離れようとしたら確認ダイアログを出す」ガード。
 *
 * Expo Router 57 は新しいナビゲーションコアで、React Navigation の
 * `usePreventRemove` / `beforeRemove` に相当する横取りフックが安定提供されて
 * いない。そこで #38 では実際に閉じる経路（画面の「×」ボタン、Android の
 * ハードウェアバック）を明示的に横取りする。iOS モーダルのスワイプ down は
 * 呼び出し側が `<Stack.Screen options={{ gestureEnabled: !dirty }}>` で塞ぐ。
 * Web のブラウザバックの横取りは #38 スコープ外（todo）。
 *
 * dirty 判定そのもの（`isDirty`）は recipeForm.ts の純粋関数。
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { BackHandler } from "react-native";

export type UnsavedChangesGuard = {
  /** 確認ダイアログを出すべきか。 */
  confirmVisible: boolean;
  /** 「閉じる」操作の入口。dirty なら確認を出し、そうでなければ即 `onLeave`。 */
  requestClose: () => void;
  /** 確認ダイアログで「破棄する」を選んだとき。 */
  confirmLeave: () => void;
  /** 確認ダイアログで「キャンセル」を選んだとき。 */
  cancelLeave: () => void;
};

export function useUnsavedChangesGuard(
  dirty: boolean,
  onLeave: () => void,
  disabled = false,
): UnsavedChangesGuard {
  const [confirmVisible, setConfirmVisible] = useState(false);

  const requestClose = useCallback(() => {
    // 保存中は、入力内容を送信し終わるまで画面を閉じない。
    if (disabled) return;
    if (dirty) {
      setConfirmVisible(true);
    } else {
      onLeave();
    }
  }, [disabled, dirty, onLeave]);

  const confirmLeave = useCallback(() => {
    if (disabled) return;
    setConfirmVisible(false);
    onLeave();
  }, [disabled, onLeave]);

  const cancelLeave = useCallback(() => setConfirmVisible(false), []);

  // Android のハードウェアバックも同じ入口に流す。
  // 画面がフォーカスされている間だけ登録する。タブを切り替えて裏に残った
  // 編集画面が、表示中の画面の戻るキーを横取りしないようにする。
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        requestClose();
        return true; // イベントを消費してデフォルトの「前の画面へ戻る」を止める
      });
      return () => sub.remove();
    }, [requestClose]),
  );

  return {
    confirmVisible: confirmVisible && !disabled,
    requestClose,
    confirmLeave,
    cancelLeave,
  };
}
