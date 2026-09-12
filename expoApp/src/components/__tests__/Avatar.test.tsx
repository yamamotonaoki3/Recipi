/**
 * Avatar のテスト（URL あり → 画像、なし → 頭文字の丸）。
 */
import { render } from "@testing-library/react-native";

import { Avatar } from "../Avatar";

describe("Avatar", () => {
  it("URL があれば画像を出す", async () => {
    const { getByTestId, queryByTestId } = await render(
      <Avatar url="https://example.com/a.jpg" displayName="テスト太郎" size={40} testID="av" />,
    );
    // expo-image は source を配列に正規化する（lessons #40-12）。
    expect(getByTestId("av").props.source).toEqual([{ uri: "https://example.com/a.jpg" }]);
    expect(queryByTestId("av-placeholder")).toBeNull();
  });

  it.each([null, undefined, ""])("URL が %p なら頭文字の丸を出す", async (url) => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <Avatar url={url} displayName="テスト太郎" size={40} testID="av" />,
    );
    expect(getByTestId("av-placeholder")).toBeTruthy();
    expect(getByText("テ")).toBeTruthy();
    expect(queryByTestId("av")).toBeNull();
  });

  it("絵文字で始まる名前は絵文字全体を頭文字にする", async () => {
    const { getByTestId, getByText } = await render(
      <Avatar url={null} displayName="🍣太郎" size={40} testID="av" />,
    );

    expect(getByTestId("av-placeholder")).toBeTruthy();
    expect(getByText("🍣")).toBeTruthy();
  });

  it("testID が無くても描画できる", async () => {
    const { getByText } = await render(<Avatar url={null} displayName="A" size={8} />);
    expect(getByText("A")).toBeTruthy();
  });
});
