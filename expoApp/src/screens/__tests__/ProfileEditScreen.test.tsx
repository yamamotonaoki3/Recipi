/**
 * プロフィール編集画面のテスト（Issue #94）。
 *
 * BB: 画面の状態（読み込み中 / 失敗 / 表示）、境界値、変更項目だけの送信、未保存ガード。
 * WB: サーバー 400 の欄への割り当て、アバターの設定 / 削除 / 失敗、自動で消える通知。
 * 通知の消え方は偽のタイマーで確かめる（lessons #92）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { AVATAR_TOAST_MS, ProfileEditScreen } from "../ProfileEditScreen";
import { ApiError } from "@/features/auth/api";
import { pickImage } from "@/features/image/pickImage";
import { useUnsavedChangesStore } from "@/features/navigation/unsavedChanges";
import { deleteAvatar, getMyProfile, putAvatar, updateMe } from "@/features/profile/api";
import { profileKeys } from "@/features/profile/hooks";
import { useSession } from "@/store/session";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockStackScreen = jest.fn((_props: unknown) => null);
let mockCanGoBack = true;
let mockIsFocused = true;
const mockFocusListeners = new Set<() => void>();

function setMockFocus(isFocused: boolean) {
  mockIsFocused = isFocused;
  mockFocusListeners.forEach((listener) => listener());
}

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const isFocused = React.useSyncExternalStore(
      (listener) => {
        mockFocusListeners.add(listener);
        return () => mockFocusListeners.delete(listener);
      },
      () => mockIsFocused,
    );
    React.useEffect(() => {
      if (!isFocused) return;
      return effect();
    }, [effect, isFocused]);
  },
  Stack: {
    Screen: (props: unknown) => {
      mockStackScreen(props);
      return null;
    },
  },
}));
jest.mock("@/features/profile/api", () => ({
  getMyProfile: jest.fn(),
  updateMe: jest.fn(),
  putAvatar: jest.fn(),
  deleteAvatar: jest.fn(),
}));
jest.mock("@/features/image/pickImage", () => ({ pickImage: jest.fn() }));
jest.mock("@/lib/secureStorage", () => ({
  secureStorage: { setUser: jest.fn().mockResolvedValue(undefined) },
}));

const mockGetMyProfile = getMyProfile as jest.Mock;
const mockUpdateMe = updateMe as jest.Mock;
const mockPutAvatar = putAvatar as jest.Mock;
const mockDeleteAvatar = deleteAvatar as jest.Mock;
const mockPickImage = pickImage as jest.Mock;

const profile = {
  id: "u1",
  displayName: "旧名前",
  email: "testuser_001@example.com",
  avatarUrl: null as string | null,
  followingCount: 0,
  followerCount: 0,
  isFollowing: null,
  emailPublic: false,
  xUrl: "https://x.com/testuser_001",
  xPublic: true,
  instagramUrl: null,
  instagramPublic: false,
  otherUrl: null,
  otherPublic: false,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function wrapperWithClient(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** 画面を描画し、フォームが表示されるまで待つ。 */
async function renderLoaded() {
  const utils = await render(<ProfileEditScreen />, { wrapper });
  await utils.findByTestId("profile-edit-display-name");
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockIsFocused = true;
  const requestClose = useUnsavedChangesStore.getState().requestClose;
  if (requestClose) {
    useUnsavedChangesStore.getState().clearRequestClose(requestClose);
  }
  useSession.getState().clear();
  useSession.getState().setAuth({
    accessToken: "a",
    refreshToken: "r",
    user: { id: "u1", displayName: "旧名前" },
    rememberMe: false,
  });
  useSession.getState().setHydrated(true);
  mockGetMyProfile.mockResolvedValue({ ...profile });
});

describe("読み込み", () => {
  it("読み込み中はスケルトンを出し、保存は押せない", async () => {
    mockGetMyProfile.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = await render(<ProfileEditScreen />, { wrapper });
    expect(getByTestId("profile-edit-skeleton")).toBeTruthy();
    await fireEvent.press(getByTestId("profile-edit-save"));
    expect(mockUpdateMe).not.toHaveBeenCalled();
  });

  it("失敗したら再試行できる", async () => {
    mockGetMyProfile.mockRejectedValueOnce(new Error("x"));
    const { findByTestId, getByTestId } = await render(<ProfileEditScreen />, { wrapper });
    await fireEvent.press(await findByTestId("profile-edit-retry"));
    await waitFor(() => expect(getByTestId("profile-edit-display-name")).toBeTruthy());
    expect(mockGetMyProfile).toHaveBeenCalledTimes(2);
  });

  it("古いキャッシュがあっても再取得の結果でフォームを初期化する", async () => {
    let resolveProfile: (value: typeof profile) => void = () => {};
    mockGetMyProfile.mockReturnValue(
      new Promise<typeof profile>((resolve) => {
        resolveProfile = resolve;
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(profileKeys.detail("u1"), { ...profile, displayName: "古いキャッシュ" });

    const { getByTestId, queryByTestId } = await render(<ProfileEditScreen />, {
      wrapper: wrapperWithClient(client),
    });
    expect(getByTestId("profile-edit-skeleton")).toBeTruthy();
    expect(queryByTestId("profile-edit-display-name")).toBeNull();

    await act(async () => {
      resolveProfile({ ...profile, displayName: "再取得した名前" });
    });
    await waitFor(() => {
      expect(getByTestId("profile-edit-display-name").props.value).toBe("再取得した名前");
    });
  });

  it("新しいキャッシュがあって再取得が起きないときはすぐフォームを出す", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    client.setQueryData(profileKeys.detail("u1"), { ...profile, displayName: "新しいキャッシュ" });

    const { getByTestId } = await render(<ProfileEditScreen />, {
      wrapper: wrapperWithClient(client),
    });

    expect(getByTestId("profile-edit-display-name").props.value).toBe("新しいキャッシュ");
    expect(mockGetMyProfile).not.toHaveBeenCalled();
  });

  it("ログイン済みなのにユーザー情報が無ければログインし直しを案内する", async () => {
    useSession.getState().setAuth({
      accessToken: "a",
      refreshToken: "r",
      user: null,
      rememberMe: false,
    });
    const { getByText, queryByTestId } = await render(<ProfileEditScreen />, { wrapper });

    expect(getByText("読み込みに失敗しました。ログインし直してください。")).toBeTruthy();
    expect(queryByTestId("profile-edit-retry")).toBeNull();
    expect(queryByTestId("profile-edit-skeleton")).toBeNull();
    expect(mockGetMyProfile).not.toHaveBeenCalled();
  });

  it("サーバーの値を初期値として表示する", async () => {
    const { getByTestId } = await renderLoaded();
    expect(getByTestId("profile-edit-display-name").props.value).toBe("旧名前");
    expect(getByTestId("profile-edit-email").props.children).toBe("testuser_001@example.com");
    expect(getByTestId("profile-edit-email-public").props.value).toBe(false);
    expect(getByTestId("profile-edit-x-url").props.value).toBe("https://x.com/testuser_001");
    expect(getByTestId("profile-edit-x-public").props.value).toBe(true);
    expect(getByTestId("profile-edit-instagram-url").props.value).toBe("");
  });

  it("読み込み中の戻るは確認なしで戻る", async () => {
    mockGetMyProfile.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = await render(<ProfileEditScreen />, { wrapper });
    await fireEvent.press(getByTestId("profile-edit-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe("保存", () => {
  it("変更した項目だけを送り、成功したら戻る", async () => {
    mockUpdateMe.mockResolvedValue({ ...profile, displayName: "新名前" });
    const { getByTestId } = await renderLoaded();

    await fireEvent.changeText(getByTestId("profile-edit-display-name"), "新名前");
    await fireEvent(getByTestId("profile-edit-email-public"), "valueChange", true);
    await fireEvent.changeText(getByTestId("profile-edit-x-url"), "");
    await fireEvent.press(getByTestId("profile-edit-save"));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockUpdateMe).toHaveBeenCalledWith({
      displayName: "新名前",
      emailPublic: true,
      xUrl: null,
    });
  });

  it("保存中は入力と戻る操作を無効にする", async () => {
    let resolveUpdate: (value: typeof profile) => void = () => {};
    mockUpdateMe.mockReturnValue(
      new Promise<typeof profile>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const { getByTestId, queryByTestId } = await renderLoaded();

    await fireEvent.changeText(getByTestId("profile-edit-display-name"), "新名前");
    await fireEvent.press(getByTestId("profile-edit-save"));

    await waitFor(() =>
      expect(getByTestId("profile-edit-display-name").props.editable).toBe(false),
    );
    expect(getByTestId("profile-edit-x-url").props.editable).toBe(false);
    for (const testID of [
      "profile-edit-email-public",
      "profile-edit-x-public",
      "profile-edit-instagram-public",
      "profile-edit-other-public",
    ]) {
      expect(getByTestId(testID).props.disabled).toBe(true);
    }

    await fireEvent.press(getByTestId("profile-edit-back"));
    expect(mockBack).not.toHaveBeenCalled();
    expect(queryByTestId("profile-edit-discard")).toBeNull();

    await act(async () => {
      resolveUpdate({ ...profile, displayName: "新名前" });
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });

  it("変更が無ければ送らずに戻る", async () => {
    const { getByTestId } = await renderLoaded();
    await fireEvent.press(getByTestId("profile-edit-save"));
    expect(mockUpdateMe).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("戻り先が無ければマイページへ置き換える", async () => {
    mockCanGoBack = false;
    const { getByTestId } = await renderLoaded();
    await fireEvent.press(getByTestId("profile-edit-save"));
    expect(mockReplace).toHaveBeenCalledWith("/my-page");
  });

  it.each([
    ["", "表示名を入力してください"],
    ["あ".repeat(31), "表示名は30文字以内で入力してください"],
  ])("表示名 %p は欄の下にエラーを出して送らない", async (value, message) => {
    const { getByTestId } = await renderLoaded();
    await fireEvent.changeText(getByTestId("profile-edit-display-name"), value);
    await fireEvent.press(getByTestId("profile-edit-save"));
    expect(getByTestId("profile-edit-display-name-error").props.children).toBe(message);
    expect(mockUpdateMe).not.toHaveBeenCalled();
  });

  it("不正な URL は欄の下にエラーを出して送らず、直すと消える", async () => {
    const { getByTestId, queryByTestId } = await renderLoaded();
    await fireEvent.changeText(getByTestId("profile-edit-other-url"), "ftp://example.com");
    await fireEvent.press(getByTestId("profile-edit-save"));
    expect(getByTestId("profile-edit-other-url-error")).toBeTruthy();
    expect(mockUpdateMe).not.toHaveBeenCalled();

    await fireEvent.changeText(getByTestId("profile-edit-other-url"), "https://example.com");
    expect(queryByTestId("profile-edit-other-url-error")).toBeNull();
  });

  it("サーバーの 400 は該当する欄に出す", async () => {
    mockUpdateMe.mockRejectedValue(
      new ApiError("不正です", "VALIDATION_ERROR", 400, {
        errors: [{ loc: ["body", "instagramUrl"], msg: "URL の形式が不正です" }],
      }),
    );
    const { getByTestId, findByTestId } = await renderLoaded();
    await fireEvent.changeText(getByTestId("profile-edit-instagram-url"), "https://a");
    await fireEvent.press(getByTestId("profile-edit-save"));

    expect((await findByTestId("profile-edit-instagram-url-error")).props.children).toBe(
      "URL の形式が不正です",
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("欄に割り当てられない失敗は「保存に失敗しました」", async () => {
    mockUpdateMe.mockRejectedValue(new Error("network"));
    const { getByTestId, findByTestId } = await renderLoaded();
    await fireEvent.changeText(getByTestId("profile-edit-display-name"), "新名前");
    await fireEvent.press(getByTestId("profile-edit-save"));
    expect((await findByTestId("profile-edit-error")).props.children).toBe("保存に失敗しました");
  });
});

describe("未保存ガード", () => {
  it("フォーカス中で dirty なら requestClose を登録する", async () => {
    const { getByTestId } = await renderLoaded();
    await fireEvent(getByTestId("profile-edit-x-public"), "valueChange", false);

    await waitFor(() => {
      expect(useUnsavedChangesStore.getState().requestClose).not.toBeNull();
    });
  });

  it("フォーカスが外れたら requestClose の登録を外す", async () => {
    const utils = await renderLoaded();
    await fireEvent(utils.getByTestId("profile-edit-x-public"), "valueChange", false);

    await waitFor(() => {
      expect(useUnsavedChangesStore.getState().requestClose).not.toBeNull();
    });

    await act(async () => {
      setMockFocus(false);
    });

    await waitFor(() => {
      expect(useUnsavedChangesStore.getState().requestClose).toBeNull();
    });
  });

  it("未保存の変更がある間は iOS のスワイプバックを無効にする", async () => {
    const { getByTestId } = await renderLoaded();
    expect(mockStackScreen).toHaveBeenLastCalledWith({
      options: { gestureEnabled: true },
    });

    await fireEvent(getByTestId("profile-edit-x-public"), "valueChange", false);
    expect(mockStackScreen).toHaveBeenLastCalledWith({
      options: { gestureEnabled: false },
    });

    await fireEvent(getByTestId("profile-edit-x-public"), "valueChange", true);
    expect(mockStackScreen).toHaveBeenLastCalledWith({
      options: { gestureEnabled: true },
    });
  });

  it("変更があるまま戻ると確認を出し、キャンセルで留まり、破棄で戻る", async () => {
    const { getByTestId } = await renderLoaded();
    await fireEvent(getByTestId("profile-edit-x-public"), "valueChange", false);
    await fireEvent.press(getByTestId("profile-edit-back"));
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("profile-edit-discard-cancel"));
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("profile-edit-back"));
    await fireEvent.press(getByTestId("profile-edit-discard-confirm"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("変更が無ければそのまま戻る", async () => {
    const { getByTestId } = await renderLoaded();
    await fireEvent.press(getByTestId("profile-edit-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe("アバター", () => {
  it("選ぶとその場で保存して画像を出し、通知は 2 秒で消える", async () => {
    jest.useFakeTimers();
    try {
      mockPickImage.mockResolvedValue({ uri: "file://a", file: new Blob(["x"]) });
      // 保存後の再取得ではサーバーが新しい URL を返す（本物のサーバーと同じ）。
      mockPutAvatar.mockImplementation(async () => {
        mockGetMyProfile.mockResolvedValue({
          ...profile,
          avatarUrl: "https://example.com/new.jpg",
        });
        return { avatarUrl: "https://example.com/new.jpg" };
      });
      const { getByTestId, findByTestId, queryByTestId } = await renderLoaded();
      expect(getByTestId("profile-edit-avatar-placeholder")).toBeTruthy();

      await fireEvent.press(getByTestId("profile-edit-avatar-pick"));

      expect((await findByTestId("profile-edit-avatar")).props.source).toEqual([
        { uri: "https://example.com/new.jpg" },
      ]);
      expect(getByTestId("profile-edit-avatar-toast").props.children).toBe(
        "アバターを設定しました",
      );
      // アバターはフォームの変更に数えない（保存しても PATCH を送らない）。
      expect(mockUpdateMe).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(AVATAR_TOAST_MS - 100);
      });
      expect(queryByTestId("profile-edit-avatar-toast")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      expect(queryByTestId("profile-edit-avatar-toast")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("アップロードの失敗はメッセージを出し、元の見た目のまま", async () => {
    mockPickImage.mockResolvedValue({ uri: "file://a", file: new Blob(["x"]) });
    mockPutAvatar.mockRejectedValue(new ApiError("画像の形式が不正です", "X", 400));
    const { getByTestId, findByTestId } = await renderLoaded();

    await fireEvent.press(getByTestId("profile-edit-avatar-pick"));

    expect((await findByTestId("profile-edit-avatar-error")).props.children).toBe(
      "画像の形式が不正です",
    );
    expect(getByTestId("profile-edit-avatar-placeholder")).toBeTruthy();
  });

  it("アップロード中はスピナーを出す", async () => {
    mockPickImage.mockResolvedValue({ uri: "file://a", file: new Blob(["x"]) });
    mockPutAvatar.mockReturnValue(new Promise(() => {}));
    const { getByTestId, findByTestId } = await renderLoaded();
    await fireEvent.press(getByTestId("profile-edit-avatar-pick"));
    expect(await findByTestId("profile-edit-avatar-spinner")).toBeTruthy();
  });

  it("削除すると頭文字に戻り、削除ボタンが消える", async () => {
    mockGetMyProfile.mockResolvedValue({ ...profile, avatarUrl: "https://example.com/a.jpg" });
    mockDeleteAvatar.mockImplementation(async () => {
      mockGetMyProfile.mockResolvedValue({ ...profile, avatarUrl: null });
    });
    const { getByTestId, findByTestId, queryByTestId } = await renderLoaded();

    await fireEvent.press(await findByTestId("profile-edit-avatar-remove"));

    expect(await findByTestId("profile-edit-avatar-placeholder")).toBeTruthy();
    expect(queryByTestId("profile-edit-avatar-remove")).toBeNull();
    expect(getByTestId("profile-edit-avatar-toast").props.children).toBe("アバターを削除しました");
  });

  it("削除の失敗はメッセージを出す", async () => {
    mockGetMyProfile.mockResolvedValue({ ...profile, avatarUrl: "https://example.com/a.jpg" });
    mockDeleteAvatar.mockRejectedValue(new Error("x"));
    const { findByTestId } = await renderLoaded();

    await fireEvent.press(await findByTestId("profile-edit-avatar-remove"));

    expect((await findByTestId("profile-edit-avatar-error")).props.children).toBe(
      "アバターの削除に失敗しました",
    );
  });
});
