/**
 * マイページ / 通知スタブのテスト（screens/my-page.md・notifications.md）。
 *
 * 概要（アバター ＋ 表示名）、取得失敗時の再試行、メニューの導線を見る。
 */
import { fireEvent, render } from "@testing-library/react-native";

import { MyPageScreen } from "../MyPageScreen";
import { NotificationsScreen } from "../NotificationsScreen";
import { useSession } from "@/store/session";

const mockPush = jest.fn();
const mockLogoutMutate = jest.fn();
const mockRefetch = jest.fn();
let mockProfileQuery: { data?: unknown; isError: boolean; refetch: jest.Mock };

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock("@/features/auth/useLogout", () => ({
  useLogout: () => ({ mutate: mockLogoutMutate, isPending: false }),
}));

jest.mock("@/features/profile/hooks", () => ({
  useMyProfile: () => mockProfileQuery,
}));

beforeEach(() => {
  jest.clearAllMocks();
  useSession.getState().clear();
  mockProfileQuery = { data: undefined, isError: false, refetch: mockRefetch };
});

describe("MyPageScreen", () => {
  it("取得前はセッションの表示名と頭文字のアバターを出す", async () => {
    useSession.setState({ user: { id: "u1", displayName: "テスト太郎" } });
    const { getByTestId } = await render(<MyPageScreen basePath="/my-page" />);
    expect(getByTestId("my-page-display-name").props.children).toBe("テスト太郎");
    expect(getByTestId("my-page-avatar-placeholder")).toBeTruthy();
  });

  it("取得できたらプロフィールの表示名とアバター画像を出す", async () => {
    useSession.setState({ user: { id: "u1", displayName: "古い名前" } });
    mockProfileQuery.data = { displayName: "新しい名前", avatarUrl: "https://example.com/a.jpg" };
    const { getByTestId } = await render(<MyPageScreen basePath="/my-page" />);
    expect(getByTestId("my-page-display-name").props.children).toBe("新しい名前");
    expect(getByTestId("my-page-avatar").props.source).toEqual([
      { uri: "https://example.com/a.jpg" },
    ]);
  });

  it("取得に失敗したら再試行でき、メニューは使える", async () => {
    mockProfileQuery.isError = true;
    const { getByTestId, getByText } = await render(<MyPageScreen basePath="/my-page" />);
    expect(getByText("読み込みに失敗しました")).toBeTruthy();
    await fireEvent.press(getByTestId("my-page-retry"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(getByTestId("my-page-profile-edit")).toBeTruthy();
  });

  it("ユーザーが無くても表示名は空文字", async () => {
    const { getByTestId } = await render(<MyPageScreen basePath="/my-page" />);
    expect(getByTestId("my-page-display-name").props.children).toBe("");
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
