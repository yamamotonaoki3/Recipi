/**
 * useHealth hook のテスト。
 *
 * API クライアント（./client の `api`）を jest.mock で差し替えて、
 * バックエンド無しで「成功時 / 失敗時」の両方を確認する。
 *
 * BB（仕様）: 200 が返れば data、失敗すれば isError。
 * WB（分岐）: 成功パスとエラーパスの両方を通す。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { api } from "./client";
import { useHealth } from "./health";

// ./client の `api.GET` をテストごとに差し替えられるモックにする。
jest.mock("./client", () => ({
  api: { GET: jest.fn() },
}));
const mockGet = api.GET as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => mockGet.mockReset());

describe("useHealth", () => {
  it("200 が返ると status / env を返す", async () => {
    mockGet.mockResolvedValue({ data: { status: "ok", env: "test" }, error: undefined });

    const { result } = await renderHook(() => useHealth(), { wrapper });

    await waitFor(() => expect(result.current?.isSuccess).toBe(true));
    expect(result.current?.data).toEqual({ status: "ok", env: "test" });
  });

  it("error が返ると isError になる", async () => {
    mockGet.mockResolvedValue({ data: undefined, error: { detail: "boom" } });

    const { result } = await renderHook(() => useHealth(), { wrapper });

    await waitFor(() => expect(result.current?.isError).toBe(true));
  });
});
