/**
 * 画像の一時アップロード（`POST /images`）。Issue #40。
 *
 * ## なぜ「先にアップロード → あとでレシピ保存」の二段構えなのか
 *
 * 画像はレシピ本体より先にサーバーへ送り、返ってきた「オブジェクトキー」を
 * レシピ保存の body に載せる（`thumbnailKey` / `steps[].imageKey`）。
 * レシピ保存と同時に画像バイト列を送る形にすると、保存の失敗・やり直しの
 * たびに巨大なリクエストを送り直すことになり、編集途中の画像も保持できない。
 *
 * 先に上げた画像は、レシピから参照されるまで「一時アップロード」の状態で、
 * どこからも参照されないまま放置されるとサーバー側の GC が回収する
 * （features/image.md §3）。つまりクライアントは「上げっぱなしで保存を
 * やめた」場合の後始末を気にしなくてよい。
 */
import { api } from "@/api/client";
import { ApiError } from "@/features/auth/api";
import type { components } from "@/api/schema";

export type ImageUploadResponse = components["schemas"]["ImageUploadResponse"];

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

/**
 * `FormData` に載せるファイルの実体。
 *
 * ネイティブと web で「何を渡すか」が違うため、`pickImage.ts` が
 * プラットフォームごとに適切な値を作ってここへ渡す（詳細はそちらのコメント）。
 */
export type UploadFile = Blob | File;

function toApiError(error: unknown, status: number): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  const message = envelope?.error?.message ?? "画像のアップロードに失敗しました";
  const code = envelope?.error?.code;
  return new ApiError(message, code, status, envelope?.error?.details ?? null);
}

/**
 * 画像を 1 枚アップロードし、`{ key, url }` を返す。
 *
 * `bodySerializer` で `FormData` を組み立てているのは、この API だけが
 * JSON ではなく multipart/form-data だから。openapi-fetch は既定で body を
 * `JSON.stringify` するので、そのままでは画像を送れない。
 *
 * **`Content-Type` ヘッダーは自分で設定しない。** multipart は
 * `multipart/form-data; boundary=----XXXX` のように「区切り文字（boundary）」を
 * 含める必要があり、その値は `FormData` を送信するときに fetch が決める。
 * 手で `Content-Type: multipart/form-data` を付けると boundary が欠けて、
 * サーバーが本文を分解できず 400 になる。
 */
export async function uploadImage(file: UploadFile): Promise<ImageUploadResponse> {
  const { data, error, response } = await api.POST("/api/v1/images", {
    // openapi-typescript は multipart のファイルを `string` として型付けする
    // （OpenAPI 上は "format: binary"）。実際に渡すのは Blob / File なので、
    // ここだけ型を合わせるためのキャストが要る。
    body: { file: file as unknown as string },
    bodySerializer(body: { file: unknown }) {
      const form = new FormData();
      form.append("file", body.file as Blob);
      return form;
    },
  });

  if (error || !data) throw toApiError(error, response.status);
  return data;
}
