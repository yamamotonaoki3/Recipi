/** session ストア（Zustand）の単体テスト。WB: 各アクションの分岐。 */
import { useSession } from "./session";

beforeEach(() => {
  useSession.getState().clear();
});

describe("useSession", () => {
  it("初期状態は未認証", () => {
    const s = useSession.getState();
    expect(s.accessToken).toBeNull();
    expect(s.isAuthenticated).toBe(false);
  });

  it("トークンをセットすると認証済みになる", () => {
    useSession.getState().setAccessToken("abc");
    expect(useSession.getState().isAuthenticated).toBe(true);
  });

  it("null をセットすると未認証に戻る", () => {
    useSession.getState().setAccessToken("abc");
    useSession.getState().setAccessToken(null);
    expect(useSession.getState().isAuthenticated).toBe(false);
  });

  it("clear で消える", () => {
    useSession.getState().setAccessToken("abc");
    useSession.getState().clear();
    expect(useSession.getState().accessToken).toBeNull();
  });
});
