/**
 * オフラインの案内のテスト（Issue #133）。
 *
 * TanStack Query の `onlineManager` がオフラインのときだけ出て、オンラインに戻ると消えること。
 */
import { onlineManager } from "@tanstack/react-query";
import { act, render } from "@testing-library/react-native";

import { OfflineBanner } from "../OfflineBanner";

afterEach(() => {
  // 他のテストに影響しないよう、必ずオンラインに戻す。
  onlineManager.setOnline(true);
});

describe("OfflineBanner", () => {
  it("オンラインのあいだは何も出さない", async () => {
    onlineManager.setOnline(true);
    const { queryByTestId } = await render(<OfflineBanner />);
    expect(queryByTestId("offline-banner")).toBeNull();
  });

  it("オフラインになると案内を出し、オンラインに戻ると消える", async () => {
    onlineManager.setOnline(true);
    const { getByTestId, getByText, queryByTestId } = await render(<OfflineBanner />);

    await act(async () => {
      onlineManager.setOnline(false);
    });
    expect(getByTestId("offline-banner")).toBeTruthy();
    expect(getByText("オフラインです。つながると自動で読み込み・送信します")).toBeTruthy();

    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(queryByTestId("offline-banner")).toBeNull();
  });
});
