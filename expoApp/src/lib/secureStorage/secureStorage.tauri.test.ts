import { appDataDir } from "@tauri-apps/api/path";
import { Stronghold } from "@tauri-apps/plugin-stronghold";

import { tauriSecureStorage } from "./secureStorage.tauri";

jest.mock("@tauri-apps/api/path", () => ({ appDataDir: jest.fn().mockResolvedValue("/data") }));

const mockStore = {
  get: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
};
const mockClient = { getStore: () => mockStore };
const mockStrongholdInstance = {
  loadClient: jest.fn(),
  createClient: jest.fn(),
  save: jest.fn().mockResolvedValue(undefined),
};

jest.mock("@tauri-apps/plugin-stronghold", () => ({
  Stronghold: { load: jest.fn() },
  Client: jest.fn(),
}));

describe("tauriSecureStorage", () => {
  beforeAll(() => {
    // `secureStorage.tauri.ts` はモジュールレベルで Stronghold インスタンスを
    // 一度だけ生成してキャッシュする（`getClient()`）ため、モックの設定は
    // このファイル内で「最初に呼ばれる 1 回」だけに影響する。ここでは
    // 「クライアント未作成 → createClient で作る」経路を最初の呼び出しで
    // 通しておき、以降のテストはキャッシュされたクライアントを共有する。
    (Stronghold.load as jest.Mock).mockResolvedValue(mockStrongholdInstance);
    mockStrongholdInstance.loadClient.mockRejectedValue(new Error("no client yet"));
    mockStrongholdInstance.createClient.mockResolvedValue(mockClient);
  });

  it("初回はクライアントが無いので createClient で作る", async () => {
    mockStore.get.mockResolvedValue(null);
    await tauriSecureStorage.getRefreshToken();
    expect(appDataDir).toHaveBeenCalled();
    expect(mockStrongholdInstance.createClient).toHaveBeenCalled();
  });

  it("getRefreshToken は Vault に無ければ null を返す", async () => {
    mockStore.get.mockResolvedValue(null);
    await expect(tauriSecureStorage.getRefreshToken()).resolves.toBeNull();
  });

  it("getRefreshToken は Vault にあればデコードして返す", async () => {
    const bytes = Array.from(new TextEncoder().encode("stored-token"));
    mockStore.get.mockResolvedValue(bytes);
    await expect(tauriSecureStorage.getRefreshToken()).resolves.toBe("stored-token");
  });

  it("setRefreshToken は Vault に保存して save する", async () => {
    await tauriSecureStorage.setRefreshToken("new-token");
    expect(mockStore.insert).toHaveBeenCalledWith(
      "refreshToken",
      Array.from(new TextEncoder().encode("new-token")),
    );
    expect(mockStrongholdInstance.save).toHaveBeenCalled();
  });

  it("deleteRefreshToken は Vault から削除して save する", async () => {
    await tauriSecureStorage.deleteRefreshToken();
    expect(mockStore.remove).toHaveBeenCalledWith("refreshToken");
    expect(mockStrongholdInstance.save).toHaveBeenCalled();
  });

  it("getUser は Vault に無ければ null を返す", async () => {
    mockStore.get.mockResolvedValue(null);
    await expect(tauriSecureStorage.getUser()).resolves.toBeNull();
  });

  it("getUser は Vault にあればデコードして返す", async () => {
    const bytes = Array.from(new TextEncoder().encode('{"id":"u1"}'));
    mockStore.get.mockResolvedValue(bytes);
    await expect(tauriSecureStorage.getUser()).resolves.toBe('{"id":"u1"}');
  });

  it("setUser は Vault に保存して save する", async () => {
    await tauriSecureStorage.setUser('{"id":"u1"}');
    expect(mockStore.insert).toHaveBeenCalledWith(
      "user",
      Array.from(new TextEncoder().encode('{"id":"u1"}')),
    );
    expect(mockStrongholdInstance.save).toHaveBeenCalled();
  });

  it("deleteUser は Vault から削除して save する", async () => {
    await tauriSecureStorage.deleteUser();
    expect(mockStore.remove).toHaveBeenCalledWith("user");
    expect(mockStrongholdInstance.save).toHaveBeenCalled();
  });
});
