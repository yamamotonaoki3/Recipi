/**
 * レシピ詳細（screens/recipe-detail.md）。
 *
 * Issue #38 の範囲: サムネ / タイトル / メタ / 説明 /
 * グループ別材料（名前なしはフラット） / 番号付き手順 / 参照材料リンク /
 * 本人なら編集・削除。♡ は Issue #100、感想セクションは Issue #102 で追加した。
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { Heart } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { BackLabel } from "@/components/BackLabel";
import { Icon, ICON_COLORS } from "@/components/Icon";
import { CommentComposer, type CommentDraft } from "@/components/CommentComposer";
import { CommentItem } from "@/components/CommentItem";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RecipeDetailSkeleton } from "@/components/Skeleton";
import { RemoteImage } from "@/components/RemoteImage";
import { ApiError } from "@/features/auth/api";
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from "@/features/comment/hooks";
import { useToggleFavorite } from "@/features/favorite/hooks";
import { useRecordView } from "@/features/history/hooks";
import { getListStatus } from "@/features/list/useListStatus";
import { formatQuantity, type Placement } from "@/features/recipe/formatQuantity";
import { useDeleteRecipe, useRecipe } from "@/features/recipe/hooks";
import { useSession } from "@/store/session";

export function RecipeDetailScreen({ basePath }: { basePath: string }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const recipeQuery = useRecipe(id);
  const deleteRecipe = useDeleteRecipe();
  const toggleFavorite = useToggleFavorite();
  const currentUserId = useSession((s) => s.user?.id);
  // 感想一覧。hooks は早期 return より前に呼ぶ必要があるので、ここで取得を始める。
  const comments = useComments(id);

  /**
   * 感想一覧の無限スクロール。詳細は ScrollView の中なので、一覧に FlatList を
   * 入れ子にせず（同じ向きのスクロールを入れ子にすると警告が出て、末尾の検知も
   * 効かない）、画面全体のスクロールが末尾近くに来たら次のページを読む。
   */
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 200;
    if (nearBottom && comments.hasNextPage && !comments.isFetchingNextPage) {
      void comments.fetchNextPage();
    }
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  // --- 閲覧履歴への記録（features/view-history.md §3・processing-model.md §10）---
  //
  // `GET /recipes/{id}` の **取得に成功したあと**、`POST /recipes/{id}/view` を
  // 非同期で 1 回だけ呼ぶ。`GET` 自体に副作用を持たせない（詳細は匿名でも引ける
  // 設計なので、取得の副作用として書き込みを混ぜない）。
  //
  // 「1 回だけ」が重要で、記録を**描画のたび**に走らせてはいけない。この画面は
  // 削除ダイアログの開閉などで何度も再描画されるため、そのたびに記録すると
  // 履歴の順序が不必要に動く。送信済みのレシピ ID を ref に控えて弾く
  // （ref は再描画をまたいで値が残り、書き換えても再描画を起こさない）。
  const { mutate: recordView } = useRecordView();
  const recordedRecipeIdRef = useRef<string | null>(null);
  const loadedRecipeId = recipeQuery.data?.id;

  useEffect(() => {
    if (!loadedRecipeId) return;
    if (recordedRecipeIdRef.current === loadedRecipeId) return;
    recordedRecipeIdRef.current = loadedRecipeId;
    // 結果は待たない。失敗しても履歴に載らないだけで、この画面には影響させない。
    recordView(loadedRecipeId);
  }, [loadedRecipeId, recordView]);

  if (recipeQuery.isPending) {
    // 初回の読み込み中はスケルトン（recipe-detail.md §4）。
    return (
      <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
        <RecipeDetailSkeleton testID="recipe-detail-skeleton" />
      </View>
    );
  }

  if (recipeQuery.isError) {
    const notFound = recipeQuery.error instanceof ApiError && recipeQuery.error.status === 404;
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white p-6">
        <Text className="text-neutral-600">
          {notFound ? "表示できません" : "読み込みに失敗しました"}
        </Text>
        <Pressable
          testID="recipe-detail-back"
          onPress={() => router.back()}
          accessibilityRole="button"
          className="rounded-lg border border-neutral-300 px-4 py-2"
        >
          <Text className="text-neutral-700">前の画面へ戻る</Text>
        </Pressable>
      </View>
    );
  }

  const recipe = recipeQuery.data;
  const isOwner = currentUserId != null && recipe.author.id === currentUserId;

  return (
    // 画面ルートでステータスバーの inset を確保する
    // （Issue #57 / #58。理由は RecipeEditor.tsx の同じ箇所のコメント参照）。
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {/* アプリバー */}
      <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3">
        <Pressable testID="recipe-detail-header-back" onPress={() => router.back()}>
          <BackLabel />
        </Pressable>
        {isOwner && (
          <View className="flex-row gap-3">
            <Pressable
              testID="recipe-detail-edit"
              onPress={() =>
                router.push({
                  pathname: "/(app)/recipes/[id]/edit",
                  params: { id: recipe.id, from: basePath },
                })
              }
              accessibilityRole="button"
            >
              <Text className="text-orange-600">編集</Text>
            </Pressable>
            <Pressable
              testID="recipe-detail-delete"
              onPress={() => setConfirmDelete(true)}
              accessibilityRole="button"
            >
              <Text className="text-red-600">削除</Text>
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView
        testID="recipe-detail-scroll"
        contentContainerClassName="gap-4 p-4"
        // キーボード表示中も、入力欄の送信や画像ボタンを 1 回のタップで操作できるようにする。
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        scrollEventThrottle={200}
      >
        {/* サムネイル（無ければプレースホルダ。features/image.md §2）。
            枠は 4:3 = スマホ標準カメラの比率。高さ固定にすると幅の広い画面で
            写真の上下が大きく切れてしまう（作成画面の ImagePickerField と同じ考え方）。 */}
        <View
          className="w-full items-center justify-center overflow-hidden rounded-xl bg-neutral-100"
          style={{ aspectRatio: 4 / 3 }}
        >
          {recipe.thumbnailUrl ? (
            // 署名付き URL の期限切れに備えて RemoteImage を使う（Issue #186）。
            <RemoteImage
              testID="recipe-detail-thumbnail"
              uri={recipe.thumbnailUrl}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          ) : (
            <Text testID="recipe-detail-thumbnail-placeholder" className="text-neutral-400">
              No Image
            </Text>
          )}
        </View>

        <Text testID="recipe-detail-title" className="text-2xl font-bold text-neutral-900">
          {recipe.title}
        </Text>

        <View className="flex-row items-center gap-2">
          {/* 投稿者をタップすると、他人ならプロフィール、自分ならマイページを開く。 */}
          <Pressable
            testID="recipe-detail-author"
            onPress={() => {
              // 退会済み投稿者にはプロフィール画面がないため遷移させない。
              if (recipe.author.isDeleted) return;
              // 自分の行はマイページ、他人の行はその人のプロフィールを開く。
              if (isOwner) router.navigate("/my-page" as never);
              else router.push(`${basePath}/users/${recipe.author.id}` as never);
            }}
            accessibilityRole={recipe.author.isDeleted ? undefined : "button"}
            accessibilityState={{ disabled: Boolean(recipe.author.isDeleted) }}
            className="flex-row items-center gap-2"
          >
            <Avatar
              url={recipe.author.avatarUrl}
              displayName={recipe.author.displayName}
              size={24}
              testID="recipe-detail-author-avatar"
            />
            <Text className="text-sm text-neutral-500">{recipe.author.displayName}</Text>
          </Pressable>
          {!recipe.isPublic && (
            <Text className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
              非公開
            </Text>
          )}
        </View>

        <Text className="text-sm text-neutral-500">{recipe.servings} 人分</Text>

        {/* ♡ ボタン＋お気に入り数（recipe-detail.md §3-6・§5）。押した瞬間にハートと
            数が変わる（楽観更新。失敗したら元に戻る）。送信中は二重に押せない。
            自分の非公開レシピにも付けられる（favorite.md §3）。 */}
        <Pressable
          testID="recipe-detail-favorite"
          onPress={() =>
            toggleFavorite.mutate({ recipeId: recipe.id, favorite: !recipe.isFavorited })
          }
          disabled={toggleFavorite.isPending}
          accessibilityRole="button"
          accessibilityLabel={recipe.isFavorited ? "お気に入りを解除" : "お気に入りに追加"}
          accessibilityState={{ selected: recipe.isFavorited, disabled: toggleFavorite.isPending }}
          className={`flex-row items-center gap-1 self-start rounded-full border border-neutral-200 px-3 py-1.5 ${
            toggleFavorite.isPending ? "opacity-60" : ""
          }`}
        >
          {/* お気に入り済みは赤く塗りつぶし、未登録は灰色の線だけ。 */}
          <Icon
            as={Heart}
            size={20}
            color={recipe.isFavorited ? ICON_COLORS.favorite : ICON_COLORS.subtle}
            fill={recipe.isFavorited ? ICON_COLORS.favorite : "none"}
          />
          <Text testID="recipe-detail-favorite-count" className="text-sm text-neutral-700">
            {recipe.favoriteCount}
          </Text>
        </Pressable>

        {recipe.description !== "" && (
          <Text className="text-base text-neutral-800">{recipe.description}</Text>
        )}

        {/* 材料 */}
        <View className="gap-2">
          <Text className="text-base font-bold text-neutral-900">材料</Text>
          {recipe.ingredientGroups.map((group, gi) => (
            <View key={gi} className="gap-1">
              {group.name != null && group.name !== "" && (
                <Text
                  testID={`detail-group-name-${gi}`}
                  className="text-sm font-semibold text-neutral-700"
                >
                  {group.name}
                </Text>
              )}
              {group.ingredients.map((ing, ii) => {
                // placement はサーバー（serialize_recipe）が材料ごとに解決済みの
                // 値を返す（features/unit.md §3.1）。/units を引き直さない。
                const qty = formatQuantity({
                  quantity: ing.quantity,
                  unit: ing.unit,
                  placement: ing.placement as Placement,
                });
                const isLiveRef = ing.refRecipe?.id != null;
                const isDeletedRef = ing.refRecipe?.id === null;
                return (
                  <View
                    key={ii}
                    testID={`detail-ingredient-${gi}-${ii}`}
                    className="flex-row justify-between"
                  >
                    {isLiveRef ? (
                      <Pressable
                        testID={`detail-ingredient-link-${gi}-${ii}`}
                        onPress={() =>
                          router.push(`${basePath}/recipes/${ing.refRecipe!.id}` as never)
                        }
                        accessibilityRole="link"
                      >
                        <Text className="text-base text-orange-600 underline">{ing.name}</Text>
                      </Pressable>
                    ) : isDeletedRef ? (
                      <Text
                        testID={`detail-ingredient-deleted-${gi}-${ii}`}
                        className="text-base text-neutral-500"
                      >
                        {ing.name}（削除済み）
                      </Text>
                    ) : (
                      <Text className="text-base text-neutral-800">{ing.name}</Text>
                    )}
                    <Text className="text-base text-neutral-600">{qty}</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        {/* 手順 */}
        <View className="gap-3">
          <Text className="text-base font-bold text-neutral-900">手順</Text>
          {recipe.steps.map((step, si) => (
            <View key={si} testID={`detail-step-${si}`} className="flex-row gap-2">
              <Text className="text-sm font-bold text-neutral-500">{si + 1}.</Text>
              <View className="flex-1 gap-2">
                <Text className="text-base text-neutral-800">{step.body}</Text>
                {step.imageUrl && (
                  <RemoteImage
                    testID={`detail-step-${si}-image`}
                    uri={step.imageUrl}
                    style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 8 }}
                    contentFit="cover"
                  />
                )}
              </View>
            </View>
          ))}
        </View>

        <CommentSection
          recipeId={recipe.id}
          commentCount={recipe.commentCount}
          isRecipeOwner={isOwner}
          currentUserId={currentUserId}
          comments={comments}
          onPressAuthor={(authorId) => {
            // 詳細の投稿者行と同じ分岐（自分 → マイページ、他人 → プロフィール。lessons #96-1）。
            if (authorId === currentUserId) router.navigate("/my-page" as never);
            else router.push(`${basePath}/users/${authorId}` as never);
          }}
        />
      </ScrollView>

      <ConfirmDialog
        visible={confirmDelete}
        testID="recipe-delete-dialog"
        title="レシピを削除しますか？"
        message="このレシピと関連する材料・手順が削除されます。"
        confirmLabel="削除する"
        onConfirm={() => {
          setConfirmDelete(false);
          deleteRecipe.mutate(recipe.id, {
            onSuccess: () => {
              // 詳細を直接開いていて戻り先が無いと、削除後もこの（消えた）
              // レシピの画面に留まってしまう。戻れなければホームへ replace する。
              if (router.canGoBack()) router.back();
              else router.replace(basePath as never);
            },
            // 削除に失敗したら詳細画面に留まり、エラーを知らせる（無言で閉じない）。
            onError: () => setDeleteError(true),
          });
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        visible={deleteError}
        testID="recipe-delete-error-dialog"
        title="削除に失敗しました"
        message="通信環境を確認して、もう一度お試しください。"
        confirmLabel="OK"
        destructive={false}
        onConfirm={() => setDeleteError(false)}
        onCancel={() => setDeleteError(false)}
      />
    </View>
  );
}

/** 失敗をそのまま画面に出せる文にする（サーバーのメッセージがあればそれを使う）。 */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/**
 * 感想セクション（recipe-detail.md §3-10・features/comment.md §2）。
 *
 * - 見出し「感想（数）」
 * - 入力欄（**レシピ投稿者本人には出さない**。本人は自分のレシピに書けないため）
 * - 一覧（新しい順）。末尾に「もっと見る」（画面のスクロールでも自動で続きを読む）
 * - 空状態の文言
 * - 削除は確認ダイアログを 1 つだけ持ち、どの感想を消すかを覚えておく
 */
function CommentSection({
  recipeId,
  commentCount,
  isRecipeOwner,
  currentUserId,
  comments,
  onPressAuthor,
}: {
  recipeId: string;
  commentCount: number;
  isRecipeOwner: boolean;
  currentUserId: string | undefined;
  comments: ReturnType<typeof useComments>;
  onPressAuthor: (authorId: string) => void;
}) {
  const createComment = useCreateComment(recipeId);
  const updateComment = useUpdateComment(recipeId);
  const deleteComment = useDeleteComment(recipeId);

  const [createError, setCreateError] = useState<string | null>(null);
  /** 編集中の失敗は、どの感想のものかも覚える（別の行に出さない）。 */
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null);
  // 保存中の感想を ID の集合で覚える。同じ更新 hook を共有しているため、
  // hook の variables だけでは、どの感想が保存中かを正しく分けられない。
  const [savingCommentIds, setSavingCommentIds] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteFailed, setDeleteFailed] = useState<string | null>(null);
  // 削除中の感想も ID の集合で覚える。通信中に同じ感想をもう一度削除すると、2 回目の
  // DELETE が 404 になり、削除できているのに「削除できませんでした」と出てしまうため
  // （Issue #130）。
  const [deletingCommentIds, setDeletingCommentIds] = useState<Set<string>>(() => new Set());

  const items = comments.data?.pages.flatMap((page) => page.items) ?? [];
  /**
   * 一覧の読み込みに失敗する場面は 2 つあり、直し方が違う（Issue #130）。
   * - 続きのページの読み込みの失敗 → `fetchNextPage()` でやり直す
   * - 表示中の一覧の取り直し（投稿・編集・削除のあとなど）の失敗 → `refetch()` でやり直す
   * 判定は他の一覧画面と共通の `getListStatus` にまとめてある（Issue #132）。
   */
  const {
    isInitialError: isInitialCommentError,
    isMoreError: isMoreCommentError,
    isRefreshError: isRefreshCommentError,
  } = getListStatus(comments);

  /** 削除中の集合から ID を外す（成功・失敗どちらでも呼ぶ）。 */
  function finishDeleting(commentId: string) {
    setDeletingCommentIds((ids) => {
      const next = new Set(ids);
      next.delete(commentId);
      return next;
    });
  }

  async function handleCreate(draft: CommentDraft): Promise<boolean> {
    setCreateError(null);
    try {
      await createComment.mutateAsync({ body: draft.body, imageKey: draft.imageKey });
      return true;
    } catch (error) {
      setCreateError(errorMessage(error, "感想を投稿できませんでした"));
      return false;
    }
  }

  async function handleSave(commentId: string, draft: CommentDraft): Promise<boolean> {
    setSaveError(null);
    // 保存を始めた感想だけ、入力欄とキャンセルを操作できないようにする。
    setSavingCommentIds((ids) => new Set(ids).add(commentId));
    // 画像を触っていなければ imageKey は送らない（= 変更なし。comment.md §3）。
    // 外したら null（= 削除）、選び直したら新しいキー（= 差し替え）。
    const patch = draft.imageChanged
      ? { body: draft.body, imageKey: draft.imageKey }
      : { body: draft.body };
    try {
      await updateComment.mutateAsync({ commentId, patch });
      return true;
    } catch (error) {
      setSaveError({ id: commentId, message: errorMessage(error, "感想を保存できませんでした") });
      return false;
    } finally {
      // 成功・失敗のどちらでも、保存が終わったら ID を集合から外す。
      setSavingCommentIds((ids) => {
        const next = new Set(ids);
        next.delete(commentId);
        return next;
      });
    }
  }

  return (
    <View testID="comment-section" className="gap-3 border-t border-neutral-200 pt-4">
      <Text testID="comment-heading" className="text-base font-bold text-neutral-900">
        感想（{commentCount}）
      </Text>

      {currentUserId == null ? (
        <Text testID="comment-need-login" className="text-sm text-neutral-500">
          ログインし直すと感想を書けます
        </Text>
      ) : !isRecipeOwner ? (
        <CommentComposer
          testID="comment-composer"
          submitLabel="送信"
          submitting={createComment.isPending}
          error={createError}
          onErrorDismiss={() => setCreateError(null)}
          resetOnSuccess
          onSubmit={handleCreate}
        />
      ) : null}

      {comments.isPending ? (
        <ActivityIndicator testID="comment-loading" />
      ) : isInitialCommentError ? (
        <View className="items-center gap-2">
          <Text className="text-sm text-neutral-600">感想を読み込めませんでした</Text>
          <Pressable
            testID="comment-retry"
            onPress={() => void comments.refetch()}
            accessibilityRole="button"
            className="rounded-lg border border-neutral-300 px-4 py-2"
          >
            <Text className="text-neutral-700">再試行</Text>
          </Pressable>
        </View>
      ) : items.length === 0 && !isMoreCommentError && !isRefreshCommentError ? (
        <Text testID="comment-empty" className="text-sm text-neutral-500">
          まだ感想がありません。作ってみたら感想を書いてみましょう
        </Text>
      ) : (
        <View className="gap-3">
          {items.map((comment) => (
            <CommentItem
              key={comment.id}
              testID={`comment-${comment.id}`}
              comment={comment}
              // ユーザー ID が分からない間は、誤って編集・削除権限を表示しない。
              isMine={currentUserId != null && comment.author.id === currentUserId}
              isRecipeOwner={currentUserId != null && isRecipeOwner}
              onPressAuthor={() => onPressAuthor(comment.author.id)}
              onRequestDelete={() => {
                setDeleteFailed(null);
                setDeleteTarget(comment.id);
              }}
              onSave={(draft) => handleSave(comment.id, draft)}
              saving={savingCommentIds.has(comment.id)}
              deleting={deletingCommentIds.has(comment.id)}
              saveError={saveError?.id === comment.id ? saveError.message : null}
              onSaveErrorDismiss={() => setSaveError(null)}
            />
          ))}
          {comments.hasNextPage && !isMoreCommentError && (
            <Pressable
              testID="comment-more"
              onPress={() => void comments.fetchNextPage()}
              disabled={comments.isFetchingNextPage}
              accessibilityRole="button"
              className="items-center rounded-lg border border-neutral-300 py-2"
            >
              {comments.isFetchingNextPage ? (
                <ActivityIndicator />
              ) : (
                <Text className="text-sm text-neutral-700">もっと見る</Text>
              )}
            </Pressable>
          )}
          {isMoreCommentError && (
            <View className="items-center gap-2">
              <Text className="text-sm text-neutral-600">続きを読み込めませんでした</Text>
              <Pressable
                testID="comment-more-retry"
                onPress={() => void comments.fetchNextPage()}
                accessibilityRole="button"
                className="rounded-lg border border-neutral-300 px-4 py-2"
              >
                <Text className="text-neutral-700">再試行</Text>
              </Pressable>
            </View>
          )}
          {/* 取り直しの失敗。表示中の一覧はそのまま残し、最新の状態だけ読み直す。 */}
          {isRefreshCommentError && (
            <View className="items-center gap-2">
              <Text className="text-sm text-neutral-600">最新の感想を読み込めませんでした</Text>
              <Pressable
                testID="comment-refresh-retry"
                onPress={() => void comments.refetch()}
                accessibilityRole="button"
                className="rounded-lg border border-neutral-300 px-4 py-2"
              >
                <Text className="text-neutral-700">再試行</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {deleteFailed && (
        <Text testID="comment-delete-error" className="text-sm text-red-600">
          {deleteFailed}
        </Text>
      )}

      <ConfirmDialog
        visible={deleteTarget !== null}
        testID="comment-delete-dialog"
        title="感想を削除しますか？"
        message="この感想と添付した画像が削除されます。元に戻せません。"
        confirmLabel="削除する"
        onConfirm={() => {
          const commentId = deleteTarget;
          setDeleteTarget(null);
          // 既に削除中の感想は送り直さない（二重の DELETE を防ぐ）。
          if (!commentId || deletingCommentIds.has(commentId)) return;
          setDeletingCommentIds((ids) => new Set(ids).add(commentId));
          deleteComment.mutate(
            { commentId },
            {
              onError: (error) =>
                setDeleteFailed(errorMessage(error, "感想を削除できませんでした")),
              // 成功・失敗のどちらでも、終わったら削除中の印を外す。
              onSettled: () => finishDeleting(commentId),
            },
          );
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </View>
  );
}
