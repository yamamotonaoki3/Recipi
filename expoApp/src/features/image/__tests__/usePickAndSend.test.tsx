/**
 * 汎用の「選ぶ → 送る」hook のテスト（WB: 状態遷移・キャンセル・失敗・押し直し）。
 */
import { act, renderHook } from "@testing-library/react-native";

import { ApiError } from "@/features/auth/api";

import { pickImage } from "../pickImage";
import { usePickAndSend } from "../usePickAndSend";

jest.mock("../pickImage", () => ({ pickImage: jest.fn() }));

const mockPickImage = pickImage as jest.Mock;
const picked = { uri: "file://a", file: new Blob(["x"]) };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("usePickAndSend", () => {
  it("選んだ画像を send に渡し、その結果を返す", async () => {
    mockPickImage.mockResolvedValue(picked);
    const send = jest.fn().mockResolvedValue("ok");
    const { result } = await renderHook(() => usePickAndSend<string>(send));

    let value: string | null = null;
    await act(async () => {
      value = await result.current.pickAndSend("camera");
    });

    expect(mockPickImage).toHaveBeenCalledWith("camera");
    expect(send).toHaveBeenCalledWith(picked.file);
    expect(value).toBe("ok");
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("キャンセルは null で、エラーにしない・送らない", async () => {
    mockPickImage.mockResolvedValue(null);
    const send = jest.fn();
    const { result } = await renderHook(() => usePickAndSend<string>(send));

    await act(async () => {
      await result.current.pickAndSend();
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("送信の失敗はサーバーのメッセージを出し、clearError で消せる", async () => {
    mockPickImage.mockResolvedValue(picked);
    const send = jest.fn().mockRejectedValue(new ApiError("形式が不正です", "X", 400));
    const { result } = await renderHook(() => usePickAndSend<string>(send));

    await act(async () => {
      await result.current.pickAndSend();
    });
    expect(result.current.error).toBe("形式が不正です");

    await act(async () => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it("Error 以外が投げられたら既定メッセージ", async () => {
    mockPickImage.mockRejectedValue("boom");
    const { result } = await renderHook(() => usePickAndSend<string>(jest.fn()));
    await act(async () => {
      await result.current.pickAndSend();
    });
    expect(result.current.error).toBe("画像のアップロードに失敗しました");
  });

  it("送信中は uploading になる", async () => {
    mockPickImage.mockResolvedValue(picked);
    let resolveSend: (v: string) => void = () => {};
    const send = jest.fn(() => new Promise<string>((r) => (resolveSend = r)));
    const { result } = await renderHook(() => usePickAndSend<string>(send));

    let pending: Promise<string | null> = Promise.resolve(null);
    await act(async () => {
      pending = result.current.pickAndSend();
    });
    expect(result.current.status).toBe("uploading");

    await act(async () => {
      resolveSend("done");
      await pending;
    });
    expect(result.current.status).toBe("idle");
  });

  it("押し直したら、古い試行の結果は捨てる", async () => {
    let resolveFirst: (v: typeof picked | null) => void = () => {};
    mockPickImage
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(picked);
    const send = jest.fn().mockResolvedValue("second");
    const { result } = await renderHook(() => usePickAndSend<string>(send));

    let first: Promise<string | null> = Promise.resolve(null);
    await act(async () => {
      first = result.current.pickAndSend();
    });
    expect(result.current.status).toBe("picking");

    let second: string | null = null;
    await act(async () => {
      second = await result.current.pickAndSend();
    });
    await act(async () => {
      resolveFirst(picked);
    });

    expect(second).toBe("second");
    await expect(first).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
