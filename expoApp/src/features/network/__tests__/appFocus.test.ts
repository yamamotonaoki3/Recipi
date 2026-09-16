/**
 * アプリ復帰の配線（Issue #186）のテスト。
 *
 * ネイティブには「ウィンドウがフォーカスされた」という知らせが無いので、
 * `AppState` の変化を `focusManager` に渡している。これが無いと
 * `refetchOnWindowFocus` がネイティブで一切働かない。
 */
import { focusManager } from "@tanstack/react-query";
import { AppState, Platform, type AppStateStatus } from "react-native";

import { isFocusedState, setupNativeAppFocus } from "@/features/network/appFocus";

describe("isFocusedState", () => {
  it("active のときだけフォーカスされているとみなす", () => {
    expect(isFocusedState("active")).toBe(true);
    // 画面が見えていないので未フォーカス扱い。
    expect(isFocusedState("background")).toBe(false);
    expect(isFocusedState("inactive")).toBe(false);
  });
});

// Web ではブラウザの知らせを TanStack Query が使うので、この配線はしない。
const nativeOnly = Platform.OS === "web" ? it.skip : it;

describe("setupNativeAppFocus", () => {
  nativeOnly("AppState の変化を focusManager に伝える", () => {
    let handler: ((status: AppStateStatus) => void) | undefined;
    const addEventListener = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_type, listener) => {
        handler = listener as (status: AppStateStatus) => void;
        return { remove: jest.fn() } as never;
      });
    const setFocused = jest.spyOn(focusManager, "setFocused").mockImplementation(() => undefined);

    setupNativeAppFocus();

    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    handler?.("active");
    expect(setFocused).toHaveBeenLastCalledWith(true);

    handler?.("background");
    expect(setFocused).toHaveBeenLastCalledWith(false);

    addEventListener.mockRestore();
    setFocused.mockRestore();
  });
});
