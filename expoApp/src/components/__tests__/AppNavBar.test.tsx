/**
 * ナビゲーションバー部品の WB テスト。
 *
 * いちばん確かめたいのは **ボトムバー ⇔ ナビゲーションレールの分岐**
 * （`NAV_RAIL_MIN_WIDTH` = 600px の境界）。境界値そのもの（599 / 600）で
 * 切り替わることを見る。
 */
import { fireEvent, render } from "@testing-library/react-native";
import { Text, useWindowDimensions } from "react-native";

import {
  NAV_RAIL_MIN_WIDTH,
  NavCreateButton,
  NavItemLabel,
  useIsNavRail,
} from "@/components/AppNavBar";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions");

const mockUseWindowDimensions = useWindowDimensions as unknown as jest.Mock;

function RailProbe() {
  const isRail = useIsNavRail();
  return <Text testID="probe">{isRail ? "rail" : "bottom"}</Text>;
}

function setWidth(width: number) {
  mockUseWindowDimensions.mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useIsNavRail", () => {
  it("境界値: 600px 未満はボトムバー", async () => {
    setWidth(NAV_RAIL_MIN_WIDTH - 1);
    const { getByTestId } = await render(<RailProbe />);
    expect(getByTestId("probe").props.children).toBe("bottom");
  });

  it("境界値: 600px ちょうどからナビゲーションレール", async () => {
    setWidth(NAV_RAIL_MIN_WIDTH);
    const { getByTestId } = await render(<RailProbe />);
    expect(getByTestId("probe").props.children).toBe("rail");
  });

  it("広い幅でもナビゲーションレール", async () => {
    setWidth(1280);
    const { getByTestId } = await render(<RailProbe />);
    expect(getByTestId("probe").props.children).toBe("rail");
  });
});

describe("NavItemLabel", () => {
  it("アイコンとラベルを出す", async () => {
    const { getByText } = await render(<NavItemLabel icon="🏠" label="ホーム" focused={false} />);
    expect(getByText("🏠")).toBeTruthy();
    expect(getByText("ホーム")).toBeTruthy();
  });
});

describe("NavCreateButton", () => {
  it("押すと onPress が呼ばれる（＋ はタブではなくモーダル起動）", async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<NavCreateButton onPress={onPress} />);
    await fireEvent.press(getByTestId("nav-create"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
