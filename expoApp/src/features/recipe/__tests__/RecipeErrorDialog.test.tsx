/**
 * RecipeErrorDialog の表示テスト（Issue #63）。
 */
import { fireEvent, render } from "@testing-library/react-native";

import { RecipeErrorDialog } from "../RecipeErrorDialog";
import type { FormErrorEntry } from "../collectFormErrors";

function entries(count: number): FormErrorEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    anchorKey: `step:s${i + 1}`,
    location: `手順 ${i + 1}`,
    message: `エラー ${i + 1}`,
  }));
}

const noop = () => {};

describe("RecipeErrorDialog", () => {
  it("場所とメッセージを並べて出す", async () => {
    const { getByText } = await render(
      <RecipeErrorDialog
        visible
        entries={entries(2)}
        message={null}
        onClose={noop}
        onJumpToFirst={noop}
        testID="dlg"
      />,
    );
    expect(getByText("保存できませんでした")).toBeTruthy();
    expect(getByText("手順 1")).toBeTruthy();
    expect(getByText("エラー 2")).toBeTruthy();
  });

  it("6 件以上は 5 件だけ出し、残りは件数で伝える", async () => {
    const { getByText, queryByText } = await render(
      <RecipeErrorDialog
        visible
        entries={entries(8)}
        message={null}
        onClose={noop}
        onJumpToFirst={noop}
        testID="dlg"
      />,
    );
    expect(getByText("手順 5")).toBeTruthy();
    // 6 件目以降は一覧に出さない（ダイアログが画面を覆わないようにするため）。
    expect(queryByText("手順 6")).toBeNull();
    expect(getByText("ほか 3 件のエラーがあります")).toBeTruthy();
  });

  it("欄に紐づくエラーが無ければ「最初のエラーへ移動」を出さない", async () => {
    const { queryByTestId, getByText } = await render(
      <RecipeErrorDialog
        visible
        entries={[]}
        message="保存に失敗しました"
        onClose={noop}
        onJumpToFirst={noop}
        testID="dlg"
      />,
    );
    expect(getByText("保存に失敗しました")).toBeTruthy();
    expect(queryByTestId("dlg-jump")).toBeNull();
  });

  it("ボタンがそれぞれのハンドラを呼ぶ", async () => {
    const onClose = jest.fn();
    const onJumpToFirst = jest.fn();
    const { getByTestId } = await render(
      <RecipeErrorDialog
        visible
        entries={entries(1)}
        message={null}
        onClose={onClose}
        onJumpToFirst={onJumpToFirst}
        testID="dlg"
      />,
    );
    await fireEvent.press(getByTestId("dlg-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent.press(getByTestId("dlg-jump"));
    expect(onJumpToFirst).toHaveBeenCalledTimes(1);
  });
});
