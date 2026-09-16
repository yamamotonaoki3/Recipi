/**
 * 期限切れ画像の立て直し（Issue #186）の単体テスト。
 *
 * ここで守りたいのは「**連打しない**」こと。一覧に画像が何枚も並ぶので、
 * 期限が切れると全部まとめて失敗する。歯止めが無いと 1 画面で何十回も
 * 再取得が走ってしまう。
 */
import { onlineManager, type QueryClient } from "@tanstack/react-query";

import {
  IMAGE_RECOVERY_COOLDOWN_MS,
  recoverExpiredImages,
  resetImageRecoveryCooldownForTests,
} from "@/features/image/expiredUrl";

/** `invalidateQueries` を数えるだけの偽 QueryClient。 */
function fakeClient() {
  const invalidateQueries = jest.fn();
  return {
    client: { invalidateQueries } as unknown as QueryClient,
    invalidateQueries,
  };
}

describe("recoverExpiredImages", () => {
  beforeEach(() => {
    resetImageRecoveryCooldownForTests();
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("表示中のクエリだけを取り直す", () => {
    const { client, invalidateQueries } = fakeClient();

    expect(recoverExpiredImages(client, 1_000)).toBe(true);

    // 裏に残っている古いキャッシュまで取り直すと、見えていない画面のために通信が増える。
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ type: "active" });
  });

  it("クールダウン中は何枚失敗しても 1 回しか取り直さない", () => {
    const { client, invalidateQueries } = fakeClient();
    const start = 10_000;

    expect(recoverExpiredImages(client, start)).toBe(true);
    // 同じ画面の他の画像が続けて失敗した状況。
    expect(recoverExpiredImages(client, start + 1)).toBe(false);
    expect(recoverExpiredImages(client, start + IMAGE_RECOVERY_COOLDOWN_MS - 1)).toBe(false);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    // クールダウンが明けたら、また取り直せる。
    expect(recoverExpiredImages(client, start + IMAGE_RECOVERY_COOLDOWN_MS)).toBe(true);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("オフラインのときは取り直さない", () => {
    const { client, invalidateQueries } = fakeClient();
    onlineManager.setOnline(false);

    // 電波が無いだけで失敗しているので、取り直しても同じように失敗するだけ。
    // つながったときの自動のやり直し（Issue #133）に任せる。
    expect(recoverExpiredImages(client, 1_000)).toBe(false);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
