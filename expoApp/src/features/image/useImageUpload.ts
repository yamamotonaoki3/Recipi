/**
 * 「画像を選ぶ → アップロードする → キーを受け取る」を 1 つにまとめた hook。
 * サムネイルと手順画像で共用する（Issue #40）。
 *
 * ## 状態を「選択中」と「送信中」に分ける理由
 *
 * この 2 つは利用者から見て**まったく別の出来事**なので、1 つの状態に
 * まとめてはいけない。
 *
 * - `picking`   … 端末のギャラリー / ファイル選択画面が開いている。
 *                 利用者が写真を探している時間で、通信は一切していない。
 * - `uploading` … 選ばれた画像を `POST /images` で送っている。
 *
 * 当初は両方を `uploading` にしていたため、**写真を選んでいるだけの間ずっと
 * 「アップロード中…」と表示され**、しかもボタンが押せなくなっていた。
 *
 * ## 選択画面から戻ってこない場合への備え
 *
 * 画像ピッカーは「選ばれた」「キャンセルされた」のどちらかを返すまで解決
 * しない。ところが環境によっては**そのどちらも通知されない**ことがある
 * （web 実装は生成した `<input type=file>` の `change` を待つが、
 * ブラウザや自動化ツールの都合でイベントが来ないケースがある）。
 * このとき利用者が操作不能にならないよう、**選択中もボタンを押せるまま**に
 * して、押し直せば選び直せるようにしている。
 *
 * 押し直したときは新しい試行だけを有効とみなす（`requestId` で世代管理）。
 * 古い試行が後から解決しても状態を書き換えない。そうしないと、選び直した
 * 新しい画像が、遅れて返ってきた古い選択で上書きされてしまう。
 *
 * ## この hook が持たないもの
 *
 * 成功したキーは呼び出し側（フォームの reducer）が持つ。「今のサムネイルは
 * 何か」はフォーム状態の一部で、保存されるまで生き続ける値。アップロードの
 * 一時的な状態とは寿命が違う。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { uploadImage } from "./api";
import { pickImage, type PickSource } from "./pickImage";
import { ApiError } from "@/features/auth/api";

export type UploadStatus = "idle" | "picking" | "uploading";

/**
 * アップロード結果。
 *
 * `key` は保存時にレシピへ紐付けるためのもの。`url` は**その場でプレビューを
 * 出すため**にサーバーが返してくれる表示用 URL（`ImageUploadResponse` の定義
 * にも「アップロード直後のプレビュー表示に使う」と明記されている）。
 * 公開 URL のベースはサーバー側の設定なのでクライアントでは組み立てられず、
 * これを捨てると「選んだのに画像が出ない」状態になる。
 */
export type UploadedImage = {
  key: string;
  url: string;
};

export type UseImageUploadResult = {
  status: UploadStatus;
  /** 直近の失敗メッセージ。成功・再試行の開始でクリアされる。 */
  error: string | null;
  /**
   * 画像を選んでアップロードする。成功したら `{ key, url }` を返す。
   * キャンセル・失敗のときは `null`（失敗は `error` にメッセージが入る）。
   */
  pickAndUpload: (source?: PickSource) => Promise<UploadedImage | null>;
  /** エラー表示を閉じる。 */
  clearError: () => void;
};

export function useImageUpload(): UseImageUploadResult {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // アンマウント後に setState して警告が出るのを防ぐ。画像の選択・送信は
  // 数秒かかることがあり、その間に画面を閉じられる可能性がある。
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 何回目の試行かを数える。押し直したとき、古い試行の結果を捨てるために使う。
  const latestRequestId = useRef(0);

  const safeSet = useCallback(<T>(setter: (value: T) => void, value: T) => {
    if (mounted.current) setter(value);
  }, []);

  const pickAndUpload = useCallback(
    async (source: PickSource = "library"): Promise<UploadedImage | null> => {
      latestRequestId.current += 1;
      const requestId = latestRequestId.current;
      /** この試行がもう最新でない（押し直された）なら true。 */
      const superseded = () => latestRequestId.current !== requestId;

      safeSet(setError, null);
      safeSet(setStatus, "picking" as UploadStatus);
      try {
        const picked = await pickImage(source);
        // 押し直された後に古い選択が返ってきた場合は、何も反映しない。
        if (superseded()) return null;
        // キャンセルはエラーではないので、メッセージを出さず静かに戻す。
        if (!picked) return null;

        safeSet(setStatus, "uploading" as UploadStatus);
        const uploaded = await uploadImage(picked.file);
        if (superseded()) return null;
        return { key: uploaded.key, url: uploaded.url };
      } catch (e) {
        if (superseded()) return null;
        // サーバーの 400（形式・サイズ違反）はそのメッセージが利用者向けに
        // 書かれているのでそのまま出す。権限拒否は pickImage が投げる Error。
        const message =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "画像のアップロードに失敗しました";
        safeSet(setError, message);
        return null;
      } finally {
        // 押し直されているなら、状態は新しい試行のものなので触らない。
        if (!superseded()) safeSet(setStatus, "idle" as UploadStatus);
      }
    },
    [safeSet],
  );

  const clearError = useCallback(() => setError(null), []);

  return { status, error, pickAndUpload, clearError };
}
