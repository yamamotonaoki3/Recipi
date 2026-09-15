import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type { PressableProps } from "react-native";

import TabsLayout from "../_layout";
import { useUnsavedChangesStore } from "@/features/navigation/unsavedChanges";

const mockDismissTo = jest.fn();
const mockPush = jest.fn();
const mockTabPress = jest.fn();
/** 各 TabTrigger に渡った resetOnFocus（testID ごと）。 */
const mockResetOnFocus: Record<string, boolean | undefined> = {};
let mockPathname = "/home";

jest.mock("expo-router", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ dismissTo: mockDismissTo, push: mockPush }),
}));

jest.mock("expo-router/ui", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Pressable, View } = jest.requireActual<typeof import("react-native")>("react-native");

  return {
    Tabs: ({ children }: { children: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    TabSlot: () => null,
    TabList: ({ children, testID }: { children: ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children),
    TabTrigger: ({
      children,
      onPress,
      testID,
      resetOnFocus,
    }: {
      children: ReactNode;
      onPress?: PressableProps["onPress"];
      testID: string;
      resetOnFocus?: boolean;
    }) => {
      mockResetOnFocus[testID] = resetOnFocus;
      const handlePress = () => {
        const event = {
          defaultPrevented: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
          isDefaultPrevented() {
            return this.defaultPrevented;
          },
        } as Parameters<NonNullable<PressableProps["onPress"]>>[0];

        onPress?.(event);
        if (!event.isDefaultPrevented()) {
          mockTabPress();
        }
      };

      return React.createElement(Pressable, { onPress: handlePress, testID }, children);
    },
  };
});

jest.mock("@/features/notification/hooks", () => ({
  useUnreadNotificationCount: () => ({ data: { unreadCount: 3 } }),
}));

function clearRequestClose() {
  const requestClose = useUnsavedChangesStore.getState().requestClose;
  if (requestClose) {
    useUnsavedChangesStore.getState().clearRequestClose(requestClose);
  }
  useUnsavedChangesStore.setState({ pendingByDestination: {} });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = "/home";
  clearRequestClose();
});

describe("TabsLayout のタブ再タップ", () => {
  it("未保存ガードが登録されていれば requestClose を呼び、直接戻らない", async () => {
    mockPathname = "/my-page/profile-edit";
    const requestClose = jest.fn();
    useUnsavedChangesStore.getState().registerRequestClose(requestClose);

    const { getByTestId } = await render(<TabsLayout />);
    await fireEvent.press(getByTestId("nav-my-page"));

    expect(requestClose).toHaveBeenCalledTimes(1);
    expect(mockTabPress).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it("未保存ガードがなければ従来どおり destination のルートへ戻る", async () => {
    mockPathname = "/home/recipes/r1";

    const { getByTestId } = await render(<TabsLayout />);
    await fireEvent.press(getByTestId("nav-home"));

    expect(mockDismissTo).toHaveBeenCalledWith("/home");
    expect(mockTabPress).toHaveBeenCalledTimes(1);
  });
});

describe("TabsLayout の別タブからの切り替え（Issue #156）", () => {
  it("全タブで、切り替えたときに最初の画面へ作り直す", async () => {
    await render(<TabsLayout />);

    expect(mockResetOnFocus["nav-home"]).toBe(true);
    expect(mockResetOnFocus["nav-history"]).toBe(true);
    expect(mockResetOnFocus["nav-notifications"]).toBe(true);
    expect(mockResetOnFocus["nav-my-page"]).toBe(true);
  });

  it("未保存の編集が裏にあれば作り直さず、切り替えたうえで確認を出す", async () => {
    mockPathname = "/history";
    const pending = jest.fn();
    useUnsavedChangesStore.getState().registerPending("/my-page", pending);

    const { getByTestId } = await render(<TabsLayout />);
    expect(mockResetOnFocus["nav-my-page"]).toBe(false);
    expect(mockResetOnFocus["nav-home"]).toBe(true);

    await fireEvent.press(getByTestId("nav-my-page"));

    expect(pending).toHaveBeenCalledTimes(1);
    // タブの切り替えは止めない（編集画面を出してダイアログを見せる）。
    expect(mockTabPress).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it("未保存の編集がなければ、別のタブから押しても何も呼ばずに切り替える", async () => {
    mockPathname = "/notifications";

    const { getByTestId } = await render(<TabsLayout />);
    await fireEvent.press(getByTestId("nav-home"));

    expect(mockTabPress).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it("別の destination の未保存編集は呼ばない", async () => {
    mockPathname = "/history";
    const pending = jest.fn();
    useUnsavedChangesStore.getState().registerPending("/my-page", pending);

    const { getByTestId } = await render(<TabsLayout />);
    await fireEvent.press(getByTestId("nav-home"));

    expect(pending).not.toHaveBeenCalled();
    expect(mockTabPress).toHaveBeenCalledTimes(1);
  });
});
