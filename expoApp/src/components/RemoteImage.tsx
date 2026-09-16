/**
 * サーバーから配信される画像（Issue #186）。
 *
 * `expo-image` の `Image` を薄く包み、**読み込みに失敗したらクエリを取り直す**
 * ようにしたもの。レシピのサムネ・手順画像・感想画像は期限付きの署名付き URL
 * （Issue #185）なので、画面を開いたまま期限が切れると画像だけが出なくなる。
 * その立て直しの仕組みは `features/image/expiredUrl.ts` にある。
 *
 * **アバターには使わない**。アバターは期限の無い安定 URL で、失敗したときに
 * 取り直しても意味が無い（`components/Avatar.tsx` はそのまま `Image` を使う）。
 *
 * ## 同じ URL では 1 回しか起動しない
 *
 * 画像が壊れている（オブジェクトが消えている等）場合、取り直しても同じ URL が
 * 返ってきて再び失敗する。`triedUriRef` で「この URL ではもう起動した」と覆えて
 * おき、無限に往復しないようにする。URL が変われば（＝取り直しが効いた、または
 * 別の画像に差し替わった）また 1 回だけ起動できる。
 */
import { Image } from "expo-image";
import type { ComponentProps } from "react";
import { useCallback, useRef } from "react";

import { useExpiredImageRecovery } from "@/features/image/expiredUrl";

type ExpoImageProps = ComponentProps<typeof Image>;

type RemoteImageProps = {
  /** 表示する画像の URL。 */
  uri: string;
  style?: ExpoImageProps["style"];
  contentFit?: ExpoImageProps["contentFit"];
  testID?: string;
  accessibilityLabel?: string;
};

export function RemoteImage({
  uri,
  style,
  contentFit,
  testID,
  accessibilityLabel,
}: RemoteImageProps) {
  const recover = useExpiredImageRecovery();
  const triedUriRef = useRef<string | null>(null);

  const handleError = useCallback(() => {
    if (triedUriRef.current === uri) return;
    triedUriRef.current = uri;
    recover();
  }, [recover, uri]);

  return (
    <Image
      testID={testID}
      source={{ uri }}
      style={style}
      contentFit={contentFit}
      accessibilityLabel={accessibilityLabel}
      onError={handleError}
    />
  );
}
