/**
 * マイページ / 通知スタブのテスト（screens/my-page.md・notifications.md）。
 *
 * MVP のスコープ（表示名 ＋ ログアウト ＋ 既存画面への導線、通知は空状態固定）
 * を満たしているかを見る。
 */
import { fireEvent, render } from "@testing-library/react-native";

import { MyPageScreen } from "../MyPageScreen";
import { NotificationsScreen } from "../NotificationsScreen";
import { useSession } from "@/store/session";

const mockPush = jest.fn();
const mockLogoutMutate = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock("@/features/auth/useLogout", () => ({
  useLogout: () => ({ mutate: mockLogoutMutate, isPending: false }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useSession.getState().clear();
});

describe("MyPageScreen", () => {
  it("ログイン中のユーザーの表示名を出す", async () => {
    useSession.setState({
      user: { id: "u1", displayName: "テスト太郎" },
    });
    const { getByTestId } = await render(<MyPageScreen basePath="/my-page" />);
    expect(getByTestId("my-page-display-name").props.children).toBe("テスト太郎");
  });

  it("「自分のレシピ一覧」へ push する", async () => {
    const { getByTestId } = await render(<MyPageScreen basePath="/my-page" />);
    await fireEvent.press(getByTestId("my-page-my-recipes"));
    expect(mockPush).toHaveBeenCalledWith("/my-page/my-recipes");
  });

  it("「プロフィール編集」へ push する", async () => {
    const { getByTestId } = await render(<MyPageScreen basePath="/my-page" />);
    await fireEvent.press(getByTestId("my-page-profile-edit"));
    expect(mockPush).toHaveBeenCalledWith("/my-page/profile-edit");
  });

  it("ログアウトできる", async () => {
    const { getByTestId } = await render(<MyPageScreen basePath="/my-page" />);
    await fireEvent.press(getByTestId("my-page-logout"));
    expect(mockLogoutMutate).toHaveBeenCalledTimes(1);
  });
});

describe("NotificationsScreen", () => {
  it("MVP では空状態固定のスタブを出す", async () => {
    const { getByTestId } = await render(<NotificationsScreen />);
    expect(getByTestId("notifications-empty").props.children).toBe("通知はまだありません");
  });
});
