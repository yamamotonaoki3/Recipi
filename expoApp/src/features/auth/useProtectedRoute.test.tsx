import { renderHook } from "@testing-library/react-native";

import { useProtectedRoute } from "./useProtectedRoute";
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

describe("useProtectedRoute", () => {
  it("hydrated が false の間は何もしない", async () => {
    useSession.setState({ hydrated: false });
    await renderHook(() => useProtectedRoute());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("hydrated かつ未ログインなら、ログイン画面へ差し替える（行き先は覚えない）", async () => {
    useSession.setState({ hydrated: true });
    await renderHook(() => useProtectedRoute());
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
  });

  it("hydrated かつログイン済みなら何もしない", async () => {
    useSession.getState().setAuth({ accessToken: "a", refreshToken: "r", rememberMe: false });
    useSession.setState({ hydrated: true });
    await renderHook(() => useProtectedRoute());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
