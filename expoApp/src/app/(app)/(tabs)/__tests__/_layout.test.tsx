import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type { PressableProps } from "react-native";

import TabsLayout from "../_layout";
import { useUnsavedChangesStore } from "@/features/navigation/unsavedChanges";

const mockDismissTo = jest.fn();
const mockPush = jest.fn();
const mockTabPress = jest.fn();
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
    }: {
      children: ReactNode;
      onPress?: PressableProps["onPress"];
      testID: string;
    }) => {
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

function clearRequestClose() {
  const requestClose = useUnsavedChangesStore.getState().requestClose;
  if (requestClose) {
    useUnsavedChangesStore.getState().clearRequestClose(requestClose);
  }
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
