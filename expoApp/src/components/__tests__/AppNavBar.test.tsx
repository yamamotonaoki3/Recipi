/**
 * ナビゲーションバー部品の WB テスト。
 *
 * いちばん確かめたいのは **ボトムバー ⇔ ナビゲーションレールの分岐**
 * （`NAV_RAIL_MIN_WIDTH` = 600px の境界）。境界値そのもの（599 / 600）で
 * 切り替わることを見る。
 */
import { fireEvent, render } from "@testing-library/react-native";
import { Bell, House } from "lucide-react-native";
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
    const { getByTestId, getByText } = await render(
      <NavItemLabel icon={House} label="ホーム" focused={false} iconTestID="icon" />,
    );
    expect(getByTestId("icon")).toBeTruthy();
    expect(getByText("ホーム")).toBeTruthy();
  });

  it("選択中はアイコンの線を太くし、選択外は細くする", async () => {
    // 描かれた SVG ではなく「アイコン部品に何を渡したか」を見るため、
    // 受け取った props を記録するだけの偽アイコンを渡す。
    const FakeIcon = jest.fn((_props: { strokeWidth?: number }) => null);
    const icon = FakeIcon as unknown as typeof House;
    const lastStrokeWidth = () => FakeIcon.mock.calls.at(-1)?.[0].strokeWidth;

    const { rerender } = await render(<NavItemLabel icon={icon} label="ホーム" focused />);
    expect(lastStrokeWidth()).toBe(2.5);
    await rerender(<NavItemLabel icon={icon} label="ホーム" focused={false} />);
    expect(lastStrokeWidth()).toBe(2);
  });

  it("未読件数を99+上限で表示し、0件ならバッジを隠す", async () => {
    const { getByTestId, getByText, rerender, queryByTestId } = await render(
      <NavItemLabel icon={Bell} label="通知" focused={false} badge={120} />,
    );
    expect(getByTestId("nav-notifications-badge")).toBeTruthy();
    expect(getByText("99+")).toBeTruthy();
    await rerender(<NavItemLabel icon={Bell} label="通知" focused={false} badge={0} />);
    expect(queryByTestId("nav-notifications-badge")).toBeNull();
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
