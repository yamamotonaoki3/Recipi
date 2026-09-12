/**
 * 「画像を選ぶ → サーバーへ送る」を 1 つにまとめた汎用 hook（Issue #94）。
 *
 * Issue #40 で作った `useImageUpload` の中身を、送り先を差し替えられる形に
 * 切り出したもの。レシピの画像は `POST /images`（一時アップロード）、
 * アバターは `PUT /users/me/avatar`（その場で保存）と送り先が違うだけで、
 * 「選択中と送信中を分ける」「押し直したら古い結果を捨てる」といった
 * 難しい部分はまったく同じなので、1 か所にまとめる。
 * 各状態の意味と理由は `useImageUpload.ts` の冒頭コメントを参照。
 *
 * `send` は描画のたびに作り直さないこと（`useCallback` かモジュールの関数を渡す）。
 * 作り直すと `pickAndSend` も毎回作り直され、依存している effect が余計に走る。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { pickImage, type PickSource } from "./pickImage";
import type { UploadFile } from "./api";
import { ApiError } from "@/features/auth/api";

export type UploadStatus = "idle" | "picking" | "uploading";

export type UsePickAndSendResult<T> = {
  status: UploadStatus;
  /** 直近の失敗メッセージ。成功・再試行の開始でクリアされる。 */
  error: string | null;
  /** 画像を選んで送る。キャンセル・失敗・押し直された古い試行は null。 */
  pickAndSend: (source?: PickSource) => Promise<T | null>;
  clearError: () => void;
};

export function usePickAndSend<T>(send: (file: UploadFile) => Promise<T>): UsePickAndSendResult<T> {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // アンマウント後に setState しないための印（送信中に画面を閉じられることがある）。
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 何回目の試行か。押し直したとき、古い試行の結果を捨てるために使う。
  const latestRequestId = useRef(0);

  const pickAndSend = useCallback(
    async (source: PickSource = "library"): Promise<T | null> => {
      latestRequestId.current += 1;
      const requestId = latestRequestId.current;
      const superseded = () => latestRequestId.current !== requestId;
      const safe = (fn: () => void) => {
        if (mounted.current) fn();
      };

      safe(() => setError(null));
      safe(() => setStatus("picking"));
      try {
        const picked = await pickImage(source);
        if (superseded()) return null;
        // キャンセルはエラーではないので、メッセージを出さず静かに戻す。
        if (!picked) return null;

        safe(() => setStatus("uploading"));
        const result = await send(picked.file);
        if (superseded()) return null;
        return result;
      } catch (e) {
        if (superseded()) return null;
        // サーバーの 400 は利用者向けのメッセージなのでそのまま出す。
        // 権限拒否は pickImage が投げる Error。
        const message =
          e instanceof ApiError || e instanceof Error
            ? e.message
            : "画像のアップロードに失敗しました";
        safe(() => setError(message));
        return null;
      } finally {
        if (!superseded()) safe(() => setStatus("idle"));
      }
    },
    [send],
  );

  const clearError = useCallback(() => setError(null), []);

  return { status, error, pickAndSend, clearError };
}
