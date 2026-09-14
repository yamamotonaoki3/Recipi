/**
 * 一覧の末尾の部品のテスト（Issue #132）。
 *
 * 読み込み中 → 続きの失敗 → 取り直しの失敗 の順に 1 つだけ出すこと、
 * それぞれの再試行が失敗の種類に合った処理（続き / 取り直し）を呼ぶことを確かめる。
 */
import { fireEvent, render } from "@testing-library/react-native";

import { ListFooterStatus } from "../ListFooterStatus";

const loaded = { pages: [{ items: [] }] };

function makeQuery(overrides: Partial<Parameters<typeof ListFooterStatus>[0]["query"]> = {}) {
  return {
    data: loaded,
    isError: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
    ...overrides,
  };
}

describe("ListFooterStatus", () => {
  it("何も起きていなければ何も出さない", async () => {
    const { toJSON } = await render(<ListFooterStatus query={makeQuery()} testID="list" />);
    expect(toJSON()).toBeNull();
  });

  it("続きの読み込み中はスピナーを出す（失敗の表示より優先）", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ListFooterStatus
        query={makeQuery({ isFetchingNextPage: true, isError: true, isFetchNextPageError: true })}
        testID="list"
      />,
    );
    expect(getByTestId("list-loading-more")).toBeTruthy();
    expect(queryByTestId("list-more-retry")).toBeNull();
  });

  it("続きのページの失敗では「続きを読み込めませんでした」を出し、再試行は続きを読み直す", async () => {
    const query = makeQuery({ isError: true, isFetchNextPageError: true });
    const { getByTestId, getByText, queryByTestId } = await render(
      <ListFooterStatus query={query} testID="list" />,
    );

    expect(getByText("続きを読み込めませんでした")).toBeTruthy();
    expect(queryByTestId("list-refresh-retry")).toBeNull();
    await fireEvent.press(getByTestId("list-more-retry"));

    expect(query.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(query.refetch).not.toHaveBeenCalled();
  });

  it("取り直しの失敗では「最新の状態を読み込めませんでした」を出し、再試行は取り直す", async () => {
    const query = makeQuery({ isError: true, isFetchNextPageError: false });
    const { getByTestId, getByText, queryByTestId } = await render(
      <ListFooterStatus query={query} testID="list" />,
    );

    expect(getByText("最新の状態を読み込めませんでした")).toBeTruthy();
    expect(queryByTestId("list-more-retry")).toBeNull();
    await fireEvent.press(getByTestId("list-refresh-retry"));

    expect(query.refetch).toHaveBeenCalledTimes(1);
    expect(query.fetchNextPage).not.toHaveBeenCalled();
  });

  it("まだ 1 件も読めていない失敗は、末尾には出さない（画面側の全体エラーに任せる）", async () => {
    const { toJSON } = await render(
      <ListFooterStatus query={makeQuery({ data: undefined, isError: true })} testID="list" />,
    );
    expect(toJSON()).toBeNull();
  });
});
