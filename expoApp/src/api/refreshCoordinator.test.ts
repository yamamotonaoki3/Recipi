/**
 * RefreshCoordinator の単体テスト（WB: N並行呼び出し→実行1回、成功/失敗の伝播）。
 */
import { RefreshCoordinator } from "./refreshCoordinator";

describe("RefreshCoordinator", () => {
  it("同時に複数回呼んでも refreshFn は 1 回しか実行されない", async () => {
    const refreshFn = jest.fn().mockResolvedValue({
      ok: true,
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    const coordinator = new RefreshCoordinator(refreshFn);

    const [a, b, c] = await Promise.all([
      coordinator.refresh("old-refresh"),
      coordinator.refresh("old-refresh"),
      coordinator.refresh("old-refresh"),
    ]);

    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a).toEqual({ ok: true, accessToken: "new-access", refreshToken: "new-refresh" });
  });

  it("完了後に再度呼ぶと、新しい実行が1回走る", async () => {
    const refreshFn = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, accessToken: "a1", refreshToken: "r1" })
      .mockResolvedValueOnce({ ok: true, accessToken: "a2", refreshToken: "r2" });
    const coordinator = new RefreshCoordinator(refreshFn);

    const first = await coordinator.refresh("old-1");
    const second = await coordinator.refresh("r1");

    expect(refreshFn).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ ok: true, accessToken: "a1", refreshToken: "r1" });
    expect(second).toEqual({ ok: true, accessToken: "a2", refreshToken: "r2" });
  });

  it("失敗した結果も、待っていた呼び出し全員に伝播する", async () => {
    const refreshFn = jest.fn().mockResolvedValue({ ok: false });
    const coordinator = new RefreshCoordinator(refreshFn);

    const [a, b] = await Promise.all([
      coordinator.refresh("old-refresh"),
      coordinator.refresh("old-refresh"),
    ]);

    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ ok: false });
    expect(b).toEqual({ ok: false });
  });

  it("refreshFn が例外を投げても、次の呼び出しでは新しく実行し直す", async () => {
    const refreshFn = jest
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ ok: true, accessToken: "a", refreshToken: "r" });
    const coordinator = new RefreshCoordinator(refreshFn);

    await expect(coordinator.refresh("old")).rejects.toThrow("network error");
    await expect(coordinator.refresh("old")).resolves.toEqual({
      ok: true,
      accessToken: "a",
      refreshToken: "r",
    });
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });
});
