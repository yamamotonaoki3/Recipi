/**
 * 無限スクロールの一覧の失敗の見分け方（Issue #132）。
 *
 * `useInfiniteQuery` は「続きの失敗」でも「取り直しの失敗」でも、読めた分を残したまま
 * `isError` を立てる。3 つの状態に正しく分かれるかを確かめる。
 */
import { getListStatus } from "../useListStatus";

const loaded = { pages: [{ items: [] }] };

describe("getListStatus", () => {
  it("正常なら、どの失敗も立たない", () => {
    expect(getListStatus({ data: loaded, isError: false, isFetchNextPageError: false })).toEqual({
      isInitialError: false,
      isMoreError: false,
      isRefreshError: false,
      hasListError: false,
    });
  });

  it("まだ 1 件も読めていない失敗は、全体のエラー（一覧は残らない）", () => {
    expect(getListStatus({ data: undefined, isError: true, isFetchNextPageError: false })).toEqual({
      isInitialError: true,
      isMoreError: false,
      isRefreshError: false,
      hasListError: false,
    });
  });

  it("読めた分があって続きのページだけ失敗したら、続きの失敗", () => {
    expect(getListStatus({ data: loaded, isError: true, isFetchNextPageError: true })).toEqual({
      isInitialError: false,
      isMoreError: true,
      isRefreshError: false,
      hasListError: true,
    });
  });

  it("読めた分があって取り直しに失敗したら、取り直しの失敗（続きの失敗ではない）", () => {
    expect(getListStatus({ data: loaded, isError: true, isFetchNextPageError: false })).toEqual({
      isInitialError: false,
      isMoreError: false,
      isRefreshError: true,
      hasListError: true,
    });
  });
});
