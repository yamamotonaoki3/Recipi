import { renderHook } from "@testing-library/react-native";

import { useProtectedRoute } from "./useProtectedRoute";
import { useSession } from "@/store/session";

const mockReplace = jest.fn();
const mockUsePathname = jest.fn();

jest.mock("expo-router", () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({ replace: mockReplace }),
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockUsePathname.mockReturnValue("/(app)/profile-edit");
  useSession.getState().clear();
  useSession.setState({ hydrated: false, pendingRedirect: null });
});

describe("useProtectedRoute", () => {
  it("hydrated が false の間は何もしない", async () => {
    useSession.setState({ hydrated: false });
    await renderHook(() => useProtectedRoute());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("hydrated かつ未ログインなら、行き先を覚えてログイン画面へ差し替える", async () => {
    useSession.setState({ hydrated: true });
    await renderHook(() => useProtectedRoute());
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
    expect(useSession.getState().pendingRedirect).toBe("/(app)/profile-edit");
  });

  it("hydrated かつログイン済みなら何もしない", async () => {
    useSession.getState().setAuth({ accessToken: "a", refreshToken: "r", rememberMe: false });
    useSession.setState({ hydrated: true });
    await renderHook(() => useProtectedRoute());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
