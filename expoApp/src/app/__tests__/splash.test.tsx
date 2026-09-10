/**
 * スプラッシュ画面のテスト（BB: hydrated/isAuthenticated の組み合わせで
 * それぞれ違う画面へ replace する、またはまだ遷移しない）。
 *
 * 自動ログイン復元自体はルートレイアウトの useAuthRefresh が担当するため
 * （app/_layout.tsx）、ここではその結果を表すセッションストアの状態だけを
 * 直接セットしてテストする。
 */
import { render, waitFor } from "@testing-library/react-native";

import SplashScreen from "../splash";
import { useSession } from "@/store/session";

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

beforeEach(() => {
  mockReplace.mockClear();
  useSession.getState().clear();
  useSession.setState({ hydrated: false });
});

describe("SplashScreen", () => {
  it("hydrated=false の間は遷移しない", async () => {
    await render(<SplashScreen />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("hydrated=true かつ認証済みならホームへ遷移する", async () => {
    useSession.getState().setAuth({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      rememberMe: true,
    });
    useSession.getState().setHydrated(true);

    await render(<SplashScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/home"));
  });

  it("hydrated=true かつ未認証ならログイン画面へ遷移する", async () => {
    useSession.getState().setHydrated(true);

    await render(<SplashScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(auth)/login"));
  });
});
