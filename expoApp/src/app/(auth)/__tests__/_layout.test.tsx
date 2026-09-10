import { render } from "@testing-library/react-native";

import AuthLayout from "../_layout";

jest.mock("expo-router", () => ({ Stack: () => null }));

/**
 * セーフエリアはテストごとに差し替えたいので、この spec だけ `jest.setup.js` の
 * 共通モック（inset が全て 0 固定）を上書きする。`jest.mock` のファクトリは
 * import より上に巻き上げられるため、外側の変数は `mock` で始まる名前でなければ
 * 参照できない（Jest の制約）。
 */
let mockInsets = { top: 0, right: 0, bottom: 0, left: 0 };

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

describe("AuthLayout", () => {
  afterEach(() => {
    mockInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  });

  it("正常にレンダリングされる", async () => {
    await expect(render(<AuthLayout />)).resolves.toBeDefined();
  });

  /**
   * セーフエリア（Issue #74）。
   *
   * 認証画面はタブシェルの外にあり、ボトムナビのような下端 inset を持つ
   * 要素が無い。確保しないと edge-to-edge で上端はフォームの先頭が
   * ステータスバーに潜り、下端は末尾（サインアップ画面の「ログインへ」
   * リンク）がナビゲーションバーに隠れる。
   */
  it("上下のセーフエリアを確保する", async () => {
    mockInsets = { top: 24, right: 0, bottom: 48, left: 0 };

    const { getByTestId } = await render(<AuthLayout />);

    expect(getByTestId("auth-screen")).toHaveStyle({ paddingTop: 24, paddingBottom: 48 });
  });
});
