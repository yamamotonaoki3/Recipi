/** session ストア（Zustand）の単体テスト。WB: 各アクションの分岐。 */
import { useSession } from "./session";

beforeEach(() => {
  useSession.getState().clear();
  useSession.setState({ hydrated: false });
});

describe("useSession", () => {
  it("初期状態は未認証", () => {
    const s = useSession.getState();
    expect(s.accessToken).toBeNull();
    expect(s.refreshToken).toBeNull();
    expect(s.user).toBeNull();
    expect(s.isAuthenticated).toBe(false);
  });

  it("setAuth で認証済みになり、渡した値が反映される", () => {
    useSession.getState().setAuth({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      user: { id: "u1", displayName: "テスト太郎" },
      rememberMe: true,
    });
    const s = useSession.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.accessToken).toBe("access-1");
    expect(s.refreshToken).toBe("refresh-1");
    expect(s.user).toEqual({ id: "u1", displayName: "テスト太郎" });
    expect(s.rememberMe).toBe(true);
  });

  it("setAuth で user を省略すると既存の user を保持する", () => {
    useSession.getState().setAuth({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      user: { id: "u1", displayName: "テスト太郎" },
      rememberMe: false,
    });
    useSession.getState().setAuth({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      rememberMe: false,
    });
    expect(useSession.getState().user).toEqual({ id: "u1", displayName: "テスト太郎" });
  });

  it("setAccessTokenOnly はトークンだけ更新し user は変えない", () => {
    useSession.getState().setAuth({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      user: { id: "u1", displayName: "テスト太郎" },
      rememberMe: false,
    });
    useSession.getState().setAccessTokenOnly("access-2", "refresh-2");
    const s = useSession.getState();
    expect(s.accessToken).toBe("access-2");
    expect(s.refreshToken).toBe("refresh-2");
    expect(s.user).toEqual({ id: "u1", displayName: "テスト太郎" });
  });

  it("setHydrated が反映される", () => {
    useSession.getState().setHydrated(true);
    expect(useSession.getState().hydrated).toBe(true);
  });

  it("clear でメモリ上の認証状態が消える（hydrated は変えない）", () => {
    useSession.getState().setAuth({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      user: { id: "u1", displayName: "テスト太郎" },
      rememberMe: true,
    });
    useSession.getState().setHydrated(true);
    useSession.getState().clear();
    const s = useSession.getState();
    expect(s.accessToken).toBeNull();
    expect(s.refreshToken).toBeNull();
    expect(s.user).toBeNull();
    expect(s.rememberMe).toBe(false);
    expect(s.isAuthenticated).toBe(false);
    expect(s.hydrated).toBe(true);
  });
});
