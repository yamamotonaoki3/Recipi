/**
 * スマホの通信状態を TanStack Query に伝える仕組みのテスト（Issue #133）。
 *
 * expo-network の知らせで onlineManager のオンライン / オフラインが切り替わること、
 * 「分からない」状態を切断と取り違えないこと、Web では何もしないことを確かめる。
 */
import { onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import { Platform } from "react-native";

import { isOnlineState, setupNativeConnectivity } from "../connectivity";

jest.mock("expo-network", () => ({
  getNetworkStateAsync: jest.fn(),
  addNetworkStateListener: jest.fn(),
}));

const mockGetState = Network.getNetworkStateAsync as jest.Mock;
const mockAddListener = Network.addNetworkStateListener as jest.Mock;
const originalOS = Platform.OS;

/** 登録された知らせの受け口を取り出す（テストから状態の変化を起こすため）。 */
function registeredListener(): (state: Network.NetworkState) => void {
  return mockAddListener.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetState.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  mockAddListener.mockReturnValue({ remove: jest.fn() });
});

afterEach(() => {
  Platform.OS = originalOS;
  // 他のテストに影響しないよう、既定の購読とオンラインに戻す。
  onlineManager.setEventListener(() => undefined);
  onlineManager.setOnline(true);
});

describe("isOnlineState", () => {
  it("どちらかがはっきり false ならオフライン", () => {
    expect(isOnlineState({ isConnected: false, isInternetReachable: true })).toBe(false);
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
  });

  it("分からない（undefined / null）はオンライン扱い", () => {
    expect(isOnlineState({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(isOnlineState({})).toBe(true);
  });
});

describe("setupNativeConnectivity", () => {
  it("スマホでは expo-network の知らせで onlineManager を切り替える", async () => {
    Platform.OS = "android";
    setupNativeConnectivity();

    expect(mockAddListener).toHaveBeenCalledTimes(1);
    registeredListener()({ isConnected: false, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(false);

    registeredListener()({ isConnected: true, isInternetReachable: true });
    expect(onlineManager.isOnline()).toBe(true);
  });

  it("起動時点の状態も反映する", async () => {
    Platform.OS = "ios";
    mockGetState.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    setupNativeConnectivity();

    await Promise.resolve();
    await Promise.resolve();
    expect(onlineManager.isOnline()).toBe(false);
  });

  it("Web では何もしない（ブラウザの知らせを TanStack Query がそのまま使う）", () => {
    Platform.OS = "web";
    setupNativeConnectivity();

    expect(mockAddListener).not.toHaveBeenCalled();
    expect(mockGetState).not.toHaveBeenCalled();
  });
});
