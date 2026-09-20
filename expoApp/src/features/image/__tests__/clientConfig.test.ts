import { QueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

import { CLIENT_CONFIG_QUERY_KEY, getImageMaxDimension } from "../clientConfig";
import { DEFAULT_IMAGE_MAX_DIMENSION } from "../pickImage";

jest.mock("@/api/client", () => ({ api: { GET: jest.fn() } }));

const mockGet = api.GET as jest.Mock;

describe("getImageMaxDimension", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("サーバーの公開設定を5分キャッシュして返す", async () => {
    mockGet.mockResolvedValue({ data: { imageMaxDimension: 1536 }, error: undefined });
    const client = new QueryClient();

    await expect(getImageMaxDimension(client)).resolves.toBe(1536);
    await expect(getImageMaxDimension(client)).resolves.toBe(1536);

    expect(mockGet).toHaveBeenCalledWith("/api/v1/client-config");
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(CLIENT_CONFIG_QUERY_KEY)).toEqual({ imageMaxDimension: 1536 });
  });

  it("設定取得に失敗しても既定値で画像選択を継続できる", async () => {
    mockGet.mockRejectedValue(new Error("offline"));

    await expect(getImageMaxDimension(new QueryClient())).resolves.toBe(
      DEFAULT_IMAGE_MAX_DIMENSION,
    );
  });
});
