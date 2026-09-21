import { readRememberChoice, saveRememberChoice } from "./rememberChoice";
import { usesCookieAuth } from "@/lib/authPlatform";

jest.mock("@/lib/authPlatform", () => ({ usesCookieAuth: jest.fn() }));
const mockCookie = usesCookieAuth as jest.Mock;

/** jest（ネイティブ環境）には `window.localStorage` が無いので、メモリ上の代用品を差し込む。 */
function installLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
    writable: true,
  });
  return storage;
}

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
  storage = installLocalStorage();
  mockCookie.mockReturnValue(true);
});

describe("rememberChoice", () => {
  it("Web では選択を控えて読める。未保存は false", () => {
    expect(readRememberChoice()).toBe(false);
    saveRememberChoice(true);
    expect(readRememberChoice()).toBe(true);
    saveRememberChoice(false);
    expect(readRememberChoice()).toBe(false);
  });

  it("ネイティブ / Tauri では何も書かず、復元は従来どおり true", () => {
    mockCookie.mockReturnValue(false);
    saveRememberChoice(false);
    expect(storage.getItem("recipi.rememberMe")).toBeNull();
    expect(readRememberChoice()).toBe(true);
  });

  it("localStorage が使えなくても例外にしない", () => {
    const spy = jest.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveRememberChoice(true)).not.toThrow();
    spy.mockRestore();
    const get = jest.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readRememberChoice()).toBe(false);
    get.mockRestore();
  });
});
