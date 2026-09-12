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
 * 上の仕組みの実体は、アバター（Issue #94）と共用するため
 * `usePickAndSend.ts` に切り出した。ここは送り先を `POST /images` に
 * 固定した薄いラッパー。
 *
 * ## この hook が持たないもの
 *
 * 成功したキーは呼び出し側（フォームの reducer）が持つ。「今のサムネイルは
 * 何か」はフォーム状態の一部で、保存されるまで生き続ける値。アップロードの
 * 一時的な状態とは寿命が違う。
 */
import { uploadImage, type UploadFile } from "./api";
import type { PickSource } from "./pickImage";
import { usePickAndSend, type UploadStatus } from "./usePickAndSend";

export type { UploadStatus };

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

/** 送信関数。モジュールの関数にして、描画のたびに作り直さないようにする。 */
async function sendToImages(file: UploadFile): Promise<UploadedImage> {
  const uploaded = await uploadImage(file);
  return { key: uploaded.key, url: uploaded.url };
}

export function useImageUpload(): UseImageUploadResult {
  const { status, error, pickAndSend, clearError } = usePickAndSend(sendToImages);
  return { status, error, pickAndUpload: pickAndSend, clearError };
}
