import { fireEvent, render } from "@testing-library/react-native";

import { ProofreadPanel } from "../ProofreadPanel";
import type { ProofreadSuggestion } from "../proofread";

const suggestions: ProofreadSuggestion[] = [
  { id: "title", original: "肉じゃか", corrected: "肉じゃが", changed: true },
  { id: "ingredient-1", original: "玉ねぎい", corrected: "玉ねぎ", changed: true },
  {
    id: "step-1",
    original: "肉を訳。",
    corrected: "肉を焼く。",
    changed: true,
    note: "文脈に合う表記です",
  },
];

async function renderPanel(items = suggestions) {
  const onApply = jest.fn();
  const onIgnore = jest.fn();
  const onApplyAll = jest.fn();
  const onIgnoreAll = jest.fn();
  const result = await render(
    <ProofreadPanel
      suggestions={items}
      onApply={onApply}
      onIgnore={onIgnore}
      onApplyAll={onApplyAll}
      onIgnoreAll={onIgnoreAll}
      sectionForId={(id) => {
        if (id === "title") return "タイトル";
        if (id.startsWith("ingredient")) return "材料";
        return "手順";
      }}
    />,
  );
  return { ...result, onApply, onIgnore, onApplyAll, onIgnoreAll };
}

describe("ProofreadPanel", () => {
  it("候補をタイトル・材料・手順ごとに表示する", async () => {
    const { getByText, getByTestId } = await renderPanel();

    expect(getByText("タイトル")).toBeTruthy();
    expect(getByText("材料")).toBeTruthy();
    expect(getByText("手順")).toBeTruthy();
    expect(getByTestId("proofread-suggestion-title")).toBeTruthy();
    expect(getByTestId("proofread-suggestion-ingredient-1")).toBeTruthy();
    expect(getByTestId("proofread-suggestion-step-1")).toBeTruthy();
    expect(getByText("文脈に合う表記です")).toBeTruthy();
  });

  it("個別適用・無視と一括操作で、それぞれ対応するコールバックを呼ぶ", async () => {
    const { getByTestId, onApply, onIgnore, onApplyAll, onIgnoreAll } = await renderPanel();

    await fireEvent.press(getByTestId("proofread-apply-title"));
    await fireEvent.press(getByTestId("proofread-ignore-ingredient-1"));
    await fireEvent.press(getByTestId("proofread-apply-all"));
    await fireEvent.press(getByTestId("proofread-ignore-all"));

    expect(onApply).toHaveBeenCalledWith(suggestions[0]);
    expect(onIgnore).toHaveBeenCalledWith(suggestions[1]);
    expect(onApplyAll).toHaveBeenCalledTimes(1);
    expect(onIgnoreAll).toHaveBeenCalledTimes(1);
  });

  it("候補が無いときは完了メッセージだけを表示する", async () => {
    const { getByTestId, queryByTestId } = await renderPanel([]);

    expect(getByTestId("proofread-empty")).toBeTruthy();
    expect(queryByTestId("proofread-panel")).toBeNull();
  });
});
