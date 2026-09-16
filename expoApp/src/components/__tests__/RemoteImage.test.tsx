/**
 * RemoteImage のテスト（Issue #186）。
 *
 * 署名付き URL が期限切れになると画像の読み込みが失敗する。そのときに
 * クエリを取り直して新しい URL を受け取れること、そして**同じ URL で
 * 無限に往復しない**ことを確かめる。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { resetImageRecoveryCooldownForTests } from "@/features/image/expiredUrl";

import { RemoteImage } from "../RemoteImage";

const EXPIRED = "https://example.com/private/a.jpg?X-Amz-Signature=old";
const REFRESHED = "https://example.com/private/a.jpg?X-Amz-Signature=new";

/**
 * 読み込み失敗のイベントを**毎回新しく**作る。
 *
 * `expo-image` は `onError` に渡された値の `nativeEvent` を読む（古い形との
 * 互換のため）。中身を渡さずに発火させると部品の側で落ちるし、**同じ
 * オブジェクトを使い回すと 2 回目で落ちる**（`Object.defineProperty` で
 * `nativeEvent` を書き換えるので「再定義できない」になる）。
 */
function imageErrorEvent() {
  return { nativeEvent: { error: "signed url expired" } };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = jest.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateQueries };
}

describe("RemoteImage", () => {
  beforeEach(() => {
    resetImageRecoveryCooldownForTests();
  });

  it("読み込みに失敗したら、表示中のクエリを取り直す", async () => {
    const { wrapper, invalidateQueries } = setup();
    const { getByTestId } = await render(<RemoteImage testID="img" uri={EXPIRED} />, { wrapper });

    await fireEvent(getByTestId("img"), "error", imageErrorEvent());

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ type: "active" });
  });

  it("同じ URL で失敗し続けても 1 回しか取り直さない", async () => {
    const { wrapper, invalidateQueries } = setup();
    const { getByTestId } = await render(<RemoteImage testID="img" uri={EXPIRED} />, { wrapper });

    // 画像が壊れている（オブジェクトが消えている等）と、取り直しても同じ URL が
    // 返ってきて再び失敗する。無限に往復させない。
    await fireEvent(getByTestId("img"), "error", imageErrorEvent());
    await fireEvent(getByTestId("img"), "error", imageErrorEvent());
    await fireEvent(getByTestId("img"), "error", imageErrorEvent());

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("URL が新しくなれば、また取り直せる", async () => {
    const { wrapper, invalidateQueries } = setup();
    const { getByTestId, rerender } = await render(<RemoteImage testID="img" uri={EXPIRED} />, {
      wrapper,
    });

    await fireEvent(getByTestId("img"), "error", imageErrorEvent());
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    // 取り直しが効いて新しい署名付き URL に差し替わった、という状況。
    await rerender(<RemoteImage testID="img" uri={REFRESHED} />);
    // クールダウンは時間で決まるので、ここでは明けた状態にしてから確かめる。
    resetImageRecoveryCooldownForTests();

    await fireEvent(getByTestId("img"), "error", imageErrorEvent());
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});
