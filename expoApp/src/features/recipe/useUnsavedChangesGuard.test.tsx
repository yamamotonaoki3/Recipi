import { renderHook } from "@testing-library/react-native";
import { BackHandler } from "react-native";

import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

type FocusEffect = () => void | (() => void);

let mockFocusEffect: FocusEffect | undefined;
let hasActiveBackHandler = false;
const mockAddEventListener = jest.spyOn(BackHandler, "addEventListener");

jest.mock("expo-router", () => ({
  useFocusEffect: (effect: FocusEffect) => {
    mockFocusEffect = effect;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusEffect = undefined;
  hasActiveBackHandler = false;
  mockAddEventListener.mockImplementation((_eventName, handler) => {
    void handler;
    hasActiveBackHandler = true;
    return {
      remove: () => {
        hasActiveBackHandler = false;
      },
    };
  });
});

afterAll(() => {
  mockAddEventListener.mockRestore();
});

describe("useUnsavedChangesGuard", () => {
  it("フォーカスが外れている間は戻るキーを横取りしない", async () => {
    const onLeave = jest.fn();
    await renderHook(() => useUnsavedChangesGuard(true, onLeave));

    let cleanup: void | (() => void);
    cleanup = mockFocusEffect?.();
    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
    expect(hasActiveBackHandler).toBe(true);

    cleanup?.();

    expect(hasActiveBackHandler).toBe(false);
  });
});
