/**
 * フォローの TanStack Query hooks（Issue #96）。
 *
 * - 一覧: `useConnections`（無限スクロール）
 * - フォロー / 解除: `useToggleFollow`（**楽観更新**）
 *
 * ## 楽観更新とは
 * サーバーの返事を待たずに、画面の表示（ボタンの「フォロー中」やフォロワー数）を
 * **先に**変えてしまうやり方（screens/user-profile.md §5）。押したらすぐ反応するので
 * 気持ちよく操作できる。そのかわり、失敗したときは**元の表示に戻す**必要がある。
 * そのために、書き換える前の値を控えておく（`onMutate` → `onError`）。
 */
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { FEED_ROOT_KEY } from "@/features/feed/hooks";
import { PROFILE_ROOT_KEY, profileKeys } from "@/features/profile/hooks";
import { useSession } from "@/store/session";

import {
  followUser,
  listConnections,
  unfollowUser,
  type ConnectionTab,
  type ConnectionTarget,
  type UserRowListResponse,
} from "./api";

export const CONNECTIONS_ROOT_KEY = ["connections"] as const;

export const connectionKeys = {
  list: (target: string, tab: ConnectionTab) => ["connections", target, tab] as const,
};

/**
 * フォロー中 / フォロワーの一覧（カーソルページングの無限スクロール）。
 *
 * セッションの復元が終わってログイン済みになるまでは送らない（lessons #42-15）。
 */
export function useConnections(target: ConnectionTarget | undefined, tab: ConnectionTab) {
  const hydrated = useSession((s) => s.hydrated);
  const isAuthenticated = useSession((s) => s.isAuthenticated);

  return useInfiniteQuery({
    queryKey: connectionKeys.list(target ?? "", tab),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listConnections(target as ConnectionTarget, tab, { cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: hydrated && isAuthenticated && Boolean(target),
  });
}

/** プロフィールのキャッシュのうち、フォローで変わる項目だけ。 */
type FollowCounts = {
  isFollowing?: boolean | null;
  followerCount: number;
  followingCount: number;
};

type ListRowState = {
  queryKey: QueryKey;
  pageIndex: number;
  rowIndex: number;
  isFollowing: boolean;
};

/** プロフィール、無ければ一覧から、押す前のフォロー状態を読む。 */
function getPreviousFollowing(
  queryClient: QueryClient,
  targetId: string,
  listRows: ListRowState[],
): boolean | undefined {
  const profile = queryClient.getQueryData<FollowCounts>(profileKeys.detail(targetId));
  if (typeof profile?.isFollowing === "boolean") return profile.isFollowing;
  return listRows[0]?.isFollowing;
}

/** 一覧にある相手の行を、あとで元に戻せるように場所と値を控える。 */
function getListRowStates(queryClient: QueryClient, targetId: string): ListRowState[] {
  return queryClient
    .getQueriesData<InfiniteData<UserRowListResponse>>({ queryKey: CONNECTIONS_ROOT_KEY })
    .flatMap(([queryKey, data]) =>
      data
        ? data.pages.flatMap((page, pageIndex) =>
            page.items.flatMap((row, rowIndex) =>
              row.id === targetId
                ? [{ queryKey, pageIndex, rowIndex, isFollowing: row.isFollowing }]
                : [],
            ),
          )
        : [],
    );
}

type FollowChanges = {
  profileIsFollowingChanged: boolean;
  profileFollowerCountChanged: boolean;
  myFollowingCountChanged: boolean;
};

/** 画面に出ている「フォローしたら変わるもの」を、サーバーの返事を待たずに書き換える。 */
function applyFollow(
  queryClient: QueryClient,
  targetId: string,
  myId: string,
  follow: boolean,
  previousIsFollowing: boolean | undefined,
): FollowChanges {
  const delta = follow ? 1 : -1;
  let profileIsFollowingChanged = false;
  let profileFollowerCountChanged = false;

  // 相手のプロフィール: ボタンの表記とフォロワー数。
  // 押す前の状態が分かっていて、既に同じ状態でないときだけ数を動かす。
  queryClient.setQueryData<FollowCounts>(profileKeys.detail(targetId), (old) =>
    old && typeof old.isFollowing === "boolean" && old.isFollowing !== follow
      ? (() => {
          const followerCount = Math.max(0, old.followerCount + delta);
          profileIsFollowingChanged = true;
          profileFollowerCountChanged = followerCount !== old.followerCount;
          return { ...old, isFollowing: follow, followerCount };
        })()
      : old,
  );

  // 自分のプロフィール: フォロー数（マイページに出る）。
  let myFollowingCountChanged = false;
  queryClient.setQueryData<FollowCounts>(profileKeys.detail(myId), (old) => {
    if (!old || previousIsFollowing === undefined || previousIsFollowing === follow) return old;
    const followingCount = Math.max(0, old.followingCount + delta);
    myFollowingCountChanged = followingCount !== old.followingCount;
    return { ...old, followingCount };
  });

  // 開いているフォロー・フォロワー一覧: 該当する行のボタン。
  queryClient.setQueriesData<InfiniteData<UserRowListResponse>>(
    { queryKey: CONNECTIONS_ROOT_KEY },
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((row) =>
                row.id === targetId ? { ...row, isFollowing: follow } : row,
              ),
            })),
          }
        : old,
  );

  return { profileIsFollowingChanged, profileFollowerCountChanged, myFollowingCountChanged };
}

type ToggleFollowInput = { userId: string; follow: boolean };
type ToggleFollowContext = FollowChanges & {
  myId: string | undefined;
  userId: string;
  follow: boolean;
  previousIsFollowing: boolean | undefined;
  listRows: ListRowState[];
};

/** 失敗した操作で実際に変えた項目だけを、逆向きに元へ戻す。 */
function rollbackFollow(queryClient: QueryClient, context: ToggleFollowContext) {
  const delta = context.follow ? 1 : -1;

  if (context.profileIsFollowingChanged || context.profileFollowerCountChanged) {
    queryClient.setQueryData<FollowCounts>(profileKeys.detail(context.userId), (old) => {
      if (!old) return old;
      const followerCount = context.profileFollowerCountChanged
        ? Math.max(0, old.followerCount - delta)
        : old.followerCount;
      return {
        ...old,
        ...(context.profileIsFollowingChanged ? { isFollowing: context.previousIsFollowing } : {}),
        followerCount,
      };
    });
  }

  if (context.myFollowingCountChanged && context.myId) {
    queryClient.setQueryData<FollowCounts>(profileKeys.detail(context.myId), (old) =>
      old
        ? {
            ...old,
            followingCount: Math.max(0, old.followingCount - delta),
          }
        : old,
    );
  }

  // 一覧は、失敗した相手の行だけを押す前の状態へ戻す。
  for (const rowState of context.listRows) {
    queryClient.setQueryData<InfiniteData<UserRowListResponse>>(rowState.queryKey, (old) => {
      if (!old) return old;
      const page = old.pages[rowState.pageIndex];
      const row = page?.items[rowState.rowIndex];
      if (!page || !row || row.id !== context.userId) return old;
      return {
        ...old,
        pages: old.pages.map((currentPage, pageIndex) =>
          pageIndex === rowState.pageIndex
            ? {
                ...currentPage,
                items: currentPage.items.map((currentRow, rowIndex) =>
                  rowIndex === rowState.rowIndex
                    ? { ...currentRow, isFollowing: rowState.isFollowing }
                    : currentRow,
                ),
              }
            : currentPage,
        ),
      };
    });
  }
}

/**
 * フォロー / 解除（楽観更新つき）。`follow: true` でフォロー、`false` で解除。
 *
 * 操作を始めた時点のユーザー ID を控え、完了時にログイン中のユーザーが
 * 入れ替わっていたら**何も書き込まない**（別の人のキャッシュを汚さない。lessons #94-5）。
 */
export function useToggleFollow() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ToggleFollowInput, ToggleFollowContext>({
    mutationFn: ({ userId, follow }) => (follow ? followUser(userId) : unfollowUser(userId)),

    onMutate: async ({ userId, follow }) => {
      const myId = useSession.getState().user?.id;
      const keys: QueryKey[] = [profileKeys.detail(userId), CONNECTIONS_ROOT_KEY];
      if (myId) keys.push(profileKeys.detail(myId));

      // 取得中のリクエストがあれば止める。止めないと、古い値の返事が
      // 後から届いて、先に書き換えた表示を上書きしてしまう。
      await Promise.all(keys.map((queryKey) => queryClient.cancelQueries({ queryKey })));

      const listRows = getListRowStates(queryClient, userId);
      const previousIsFollowing = getPreviousFollowing(queryClient, userId, listRows);
      const changes = myId
        ? applyFollow(queryClient, userId, myId, follow, previousIsFollowing)
        : {
            profileIsFollowingChanged: false,
            profileFollowerCountChanged: false,
            myFollowingCountChanged: false,
          };
      return { myId, userId, follow, previousIsFollowing, listRows, ...changes };
    },

    onError: (_error, _input, context) => {
      if (!context || useSession.getState().user?.id !== context.myId) return;
      rollbackFollow(queryClient, context);
    },

    onSettled: (_data, _error, _input, context) => {
      if (context && useSession.getState().user?.id !== context.myId) return;
      // 最後にサーバーの正しい値で張り替える（数の食い違いを残さない）。
      void queryClient.invalidateQueries({ queryKey: PROFILE_ROOT_KEY });
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_ROOT_KEY });
      // フォロー中の人の新着はホームの「フォロー」タブに出る（F3）。
      void queryClient.invalidateQueries({ queryKey: FEED_ROOT_KEY });
    },
  });
}
