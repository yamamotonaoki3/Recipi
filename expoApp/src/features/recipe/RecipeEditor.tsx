/**
 * レシピ作成 / 編集の共有コンポーネント（screens/recipe-editor.md）。
 *
 * - フォーム状態は useRecipeForm（recipeForm.ts の reducer）。
 * - 行編集 UX: 「+」で末尾に空行を足してそこへフォーカス、行削除で番号詰め、
 *   「↑ / ↓」で並べ替え（ドラッグは将来。todo #21）。
 * - 単位欄は GET /units の候補を前方一致で絞るオートコンプリート ＋
 *   formatQuantity のプレビュー。
 * - 未保存で閉じようとしたら確認ダイアログ（useUnsavedChangesGuard）。
 * - 画像はサムネイル 1 枚と手順ごとに 1 枚（ImagePickerField）。選んだ時点で
 *   `POST /images` に上げてキーだけ受け取り、保存時にレシピへ紐付ける（#40）。
 */
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type TextInput as RNTextInput,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { extractValidationErrors, type RecipeResponse } from "./api";
import { formatQuantity, type Placement } from "./formatQuantity";
import { useSaveRecipe, useUnits } from "./hooks";
import { RefRecipePicker } from "./RefRecipePicker";
import type { GroupRow, IngredientRow, StepRow } from "./recipeForm";
import { buildSubmission } from "./recipeForm";
import { useRecipeForm } from "./useRecipeForm";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";
import {
  hasAnyError,
  mapServerErrors,
  validateRecipeForm,
  type RecipeFormErrors,
} from "./validation";
import { ApiError } from "@/features/auth/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ImagePickerField } from "@/components/ImagePickerField";

type RecipeEditorProps =
  { mode: "create"; recipe?: undefined } | { mode: "edit"; recipe: RecipeResponse };

const emptyErrors: RecipeFormErrors = { groups: {}, ingredients: {}, steps: {} };

export function RecipeEditor({ mode, recipe }: RecipeEditorProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, dispatch, dirty } = useRecipeForm(recipe);
  const units = useUnits();
  const save = useSaveRecipe();

  const [errors, setErrors] = useState<RecipeFormErrors>(emptyErrors);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerForIngredient, setPickerForIngredient] = useState<string | null>(null);
  const [uploadingImageIds, setUploadingImageIds] = useState<Set<string>>(new Set());

  const handleImageUploadingChange = useCallback((imageId: string, uploading: boolean) => {
    setUploadingImageIds((current) => {
      // ImagePickerField の再描画で同じ通知が届くことがあるため、状態が変わらない
      // ときは同じ Set を返す。これで不要な再描画と二重カウントを防ぐ。
      if (current.has(imageId) === uploading) return current;

      const next = new Set(current);
      if (uploading) {
        next.add(imageId);
      } else {
        next.delete(imageId);
      }
      return next;
    });
  }, []);

  const handleThumbnailUploadingChange = useCallback(
    (uploading: boolean) => handleImageUploadingChange("thumbnail", uploading),
    [handleImageUploadingChange],
  );
  // 画像を選んでいる最中も、まだ reducer に新しいキーが入っていないため
  // dirty にはならない。ここで離脱すると選択結果が画面ごと失われるので、
  // 選択中とアップロード中のどちらも「未保存の作業」として扱う。
  const hasImageProcessing = uploadingImageIds.size > 0;
  const hasUnsavedWork = dirty || hasImageProcessing;

  // この画面を閉じるときの遷移先。通常はモーダルを閉じて元の画面へ戻るだけだが、
  // 編集 URL を直接開いた（＝スタックの下に画面が無い）場合は戻り先が無く
  // 閉じられなくなるので、そのときは編集モード = そのレシピの詳細へ、
  // 作成モード = ホームへ replace する。
  function leaveEditor() {
    if (router.canGoBack()) {
      router.back();
    } else if (mode === "edit") {
      router.replace(`/(app)/recipes/${recipe.id}` as never);
    } else {
      router.replace("/(app)" as never);
    }
  }

  const guard = useUnsavedChangesGuard(hasUnsavedWork, leaveEditor);

  // 「+」で追加した行へフォーカスを移したら、フォーカス済みフラグを下ろす。
  useEffect(() => {
    if (state.lastAddedRowId !== null) {
      const t = setTimeout(() => dispatch({ type: "clearLastAdded" }), 0);
      return () => clearTimeout(t);
    }
  }, [state.lastAddedRowId, dispatch]);

  function handleSave() {
    setSubmitError(null);
    const found = validateRecipeForm(state);
    setErrors(found);
    if (hasAnyError(found)) return;

    const submission = buildSubmission(state, { mode });
    save.mutate(
      mode === "edit"
        ? { mode: "edit", recipeId: recipe.id, body: submission.body }
        : { mode: "create", body: submission.body },
      {
        onSuccess: (saved) => {
          if (mode === "edit") {
            // 編集モードはスタックの下にすでに詳細画面がある。モーダルを閉じて
            // その詳細へ戻るだけでよい（useSaveRecipe が詳細クエリを invalidate
            // 済みなので最新表示に張り替わる）。replace すると詳細が二重に積まれる。
            // 直接開いていて戻り先が無ければ詳細へ replace する。
            leaveEditor();
          } else {
            // 作成画面はモーダルなので、モーダルスタックを閉じてから詳細へ
            // 遷移する。`replace` だと Android のネイティブスタック上で
            // モーダルのルートが残り、保存後も編集画面が表示され続けることがある。
            router.dismissTo(`/(app)/recipes/${saved.id}` as never);
          }
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 400) {
            const serverErrors = extractValidationErrors(error);
            if (serverErrors.length > 0) {
              // Pydantic のフィールド別エラーを該当行の下に載せる。
              setErrors(mapServerErrors(serverErrors, submission));
              setSubmitError("入力内容を確認してください");
            } else {
              // details を持たない 400（refRecipeId 検証など）はメッセージをそのまま。
              setSubmitError(error.message);
            }
          } else {
            setSubmitError("保存に失敗しました");
          }
        },
      },
    );
  }

  const unitOptions = units.data?.units ?? [];

  return (
    // 画面ルートでステータスバーの inset を確保する（Issue #57 / #58）。
    // ヘッダー側の `py-3` を上書きしないよう、パディングはここで足す。
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {/* 未保存の変更または画像処理中は iOS モーダルのスワイプ down を無効化する
          （スワイプで閉じると requestClose を通らず確認ダイアログが出ないため。
          Android のハードウェアバックは useUnsavedChangesGuard が横取りする）。 */}
      <Stack.Screen options={{ gestureEnabled: !hasUnsavedWork }} />

      {/* アプリバー: × / タイトル / 保存。
          Android 15 以降は edge-to-edge が強制で、画面ルートで inset を
          確保しないとこのヘッダーがステータスバーの下に潜り込み、
          見た目が崩れるうえにアクセシビリティツリーからも剪定されて
          TalkBack / E2E から `editor-save` に到達できなくなる。 */}
      <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3">
        <Pressable testID="editor-close" onPress={guard.requestClose} accessibilityRole="button">
          <Text className="text-neutral-500">×</Text>
        </Pressable>
        <Text className="text-base font-bold text-neutral-900">
          {mode === "edit" ? "レシピを編集" : "レシピを作成"}
        </Text>
        {/* 選択中も含めて画像処理が終わる前は保存しない。まだキーがフォームに
            入っていない状態で遷移すると ImagePickerField が外れ、画像だけ失われるため。 */}
        <Pressable
          testID="editor-save"
          onPress={handleSave}
          disabled={save.isPending || hasImageProcessing}
          accessibilityRole="button"
        >
          <Text className="font-semibold text-orange-600">
            {save.isPending ? "保存中…" : hasImageProcessing ? "画像のアップロード中です" : "保存"}
          </Text>
        </Pressable>
      </View>

      {/* 保存リクエスト中はフォーム全体を操作不可にする（送信後に入力すると、
          その変更は body に含まれないまま成功遷移で失われるため。recipe-editor.md §4）。 */}
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        pointerEvents={save.isPending ? "none" : "auto"}
        style={save.isPending ? { opacity: 0.6 } : undefined}
      >
        {submitError && <Text className="text-sm text-red-600">{submitError}</Text>}
        {errors.form && <Text className="text-sm text-red-600">{errors.form}</Text>}

        {/* サムネイル（1 レシピに 1 枚・任意。features/image.md §2） */}
        <ImagePickerField
          testID="editor-thumbnail"
          label="サムネイル"
          variant="thumbnail"
          imageKey={state.thumbnailKey}
          imageUrl={state.thumbnailUrl}
          onChange={(key, url) => dispatch({ type: "setThumbnailKey", key, url })}
          onUploadingChange={handleThumbnailUploadingChange}
        />

        {/* タイトル */}
        <View>
          <Text className="mb-1 text-xs text-neutral-500">タイトル</Text>
          <TextInput
            testID="editor-title"
            value={state.title}
            onChangeText={(v) => dispatch({ type: "setField", field: "title", value: v })}
            placeholder="例: 肉じゃが"
            className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
          />
          {errors.title && <Text className="mt-1 text-sm text-red-600">{errors.title}</Text>}
        </View>

        {/* 説明 */}
        <View>
          <Text className="mb-1 text-xs text-neutral-500">説明</Text>
          <TextInput
            testID="editor-description"
            value={state.description}
            onChangeText={(v) => dispatch({ type: "setField", field: "description", value: v })}
            placeholder="どんなレシピか（任意）"
            multiline
            className="min-h-[72px] rounded-lg border border-neutral-300 px-3 py-2 text-base"
          />
          {errors.description && (
            <Text className="mt-1 text-sm text-red-600">{errors.description}</Text>
          )}
        </View>

        {/* 何人分 */}
        <View>
          <Text className="mb-1 text-xs text-neutral-500">何人分</Text>
          <View className="flex-row items-center gap-3">
            <Pressable
              testID="editor-servings-minus"
              onPress={() =>
                dispatch({
                  type: "setField",
                  field: "servings",
                  value: String(Math.max(1, (Number(state.servings) || 1) - 1)),
                })
              }
              accessibilityRole="button"
              className="h-9 w-9 items-center justify-center rounded-lg border border-neutral-300"
            >
              <Text className="text-lg text-neutral-700">−</Text>
            </Pressable>
            <TextInput
              testID="editor-servings"
              value={state.servings}
              onChangeText={(v) =>
                dispatch({ type: "setField", field: "servings", value: v.replace(/[^0-9]/g, "") })
              }
              keyboardType="number-pad"
              className="w-16 rounded-lg border border-neutral-300 px-3 py-2 text-center text-base"
            />
            <Pressable
              testID="editor-servings-plus"
              onPress={() =>
                dispatch({
                  type: "setField",
                  field: "servings",
                  value: String(Math.min(99, (Number(state.servings) || 0) + 1)),
                })
              }
              accessibilityRole="button"
              className="h-9 w-9 items-center justify-center rounded-lg border border-neutral-300"
            >
              <Text className="text-lg text-neutral-700">＋</Text>
            </Pressable>
          </View>
          {errors.servings && <Text className="mt-1 text-sm text-red-600">{errors.servings}</Text>}
        </View>

        {/* 材料セクション */}
        <View className="gap-3">
          <Text className="text-sm font-bold text-neutral-900">材料</Text>
          {state.groups.map((group, groupIndex) => (
            <GroupEditor
              key={group.localId}
              group={group}
              groupIndex={groupIndex}
              groupCount={state.groups.length}
              otherGroups={state.groups.filter((g) => g.localId !== group.localId)}
              lastAddedRowId={state.lastAddedRowId}
              unitOptions={unitOptions}
              errors={errors}
              dispatch={dispatch}
              onOpenPicker={setPickerForIngredient}
            />
          ))}
          <Pressable
            testID="editor-add-group"
            onPress={() => dispatch({ type: "addGroup" })}
            accessibilityRole="button"
            className="self-start rounded-lg border border-neutral-300 px-3 py-2"
          >
            <Text className="text-sm text-neutral-700">グループを追加</Text>
          </Pressable>
        </View>

        {/* 手順セクション */}
        <View className="gap-2">
          <Text className="text-sm font-bold text-neutral-900">手順</Text>
          {state.steps.map((step, index) => (
            <StepEditor
              key={step.localId}
              step={step}
              index={index}
              stepCount={state.steps.length}
              lastAddedRowId={state.lastAddedRowId}
              error={errors.steps[step.localId]}
              dispatch={dispatch}
              onImageUploadingChange={handleImageUploadingChange}
            />
          ))}
          <Pressable
            testID="editor-add-step"
            onPress={() => dispatch({ type: "addStep" })}
            accessibilityRole="button"
            className="self-start rounded-lg border border-neutral-300 px-3 py-2"
          >
            <Text className="text-sm text-neutral-700">手順を追加</Text>
          </Pressable>
        </View>

        {/* 公開フラグ */}
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-neutral-900">公開する</Text>
          <Switch
            testID="editor-is-public"
            value={state.isPublic}
            onValueChange={(v) => dispatch({ type: "setIsPublic", value: v })}
          />
        </View>
      </ScrollView>

      {/* ピッカーは開いたときだけマウントする（一覧クエリを常時走らせない）。 */}
      {pickerForIngredient !== null && (
        <RefRecipePicker
          visible
          excludeRecipeId={mode === "edit" ? recipe.id : undefined}
          onSelect={(picked) => {
            dispatch({
              type: "linkRefRecipe",
              ingredientId: pickerForIngredient,
              recipeId: picked.id,
              title: picked.title,
            });
            setPickerForIngredient(null);
          }}
          onClose={() => setPickerForIngredient(null)}
        />
      )}

      <ConfirmDialog
        visible={guard.confirmVisible}
        testID="editor-discard-dialog"
        title="編集内容を破棄しますか？"
        message="保存していない変更や処理中の画像は失われます。"
        confirmLabel="破棄する"
        onConfirm={guard.confirmLeave}
        onCancel={guard.cancelLeave}
      />
    </View>
  );
}

// --- グループ 1 つ ------------------------------------------------

type Dispatch = ReturnType<typeof useRecipeForm>["dispatch"];

function GroupEditor({
  group,
  groupIndex,
  groupCount,
  otherGroups,
  lastAddedRowId,
  unitOptions,
  errors,
  dispatch,
  onOpenPicker,
}: {
  group: GroupRow;
  groupIndex: number;
  groupCount: number;
  otherGroups: GroupRow[];
  lastAddedRowId: string | null;
  unitOptions: { value: string; placement: string }[];
  errors: RecipeFormErrors;
  dispatch: Dispatch;
  onOpenPicker: (ingredientId: string) => void;
}) {
  return (
    <View className="gap-2 rounded-lg border border-neutral-200 p-3">
      <View className="flex-row items-center gap-2">
        <TextInput
          testID={`group-name-${groupIndex}`}
          value={group.name}
          onChangeText={(v) => dispatch({ type: "renameGroup", groupId: group.localId, name: v })}
          placeholder="グループ名（任意・例: 合わせ調味料A）"
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-2 text-sm"
        />
        {groupCount > 1 && (
          <>
            <MoveButtons
              testIDPrefix={`group-${groupIndex}`}
              canUp={groupIndex > 0}
              canDown={groupIndex < groupCount - 1}
              onUp={() => dispatch({ type: "moveGroup", groupId: group.localId, direction: "up" })}
              onDown={() =>
                dispatch({ type: "moveGroup", groupId: group.localId, direction: "down" })
              }
            />
            <Pressable
              testID={`group-remove-${groupIndex}`}
              onPress={() => dispatch({ type: "removeGroup", groupId: group.localId })}
              accessibilityRole="button"
            >
              <Text className="px-1 text-sm text-red-600">削除</Text>
            </Pressable>
          </>
        )}
      </View>
      {errors.groups[group.localId] && (
        <Text className="text-sm text-red-600">{errors.groups[group.localId]}</Text>
      )}

      {group.ingredients.map((ing, ingIndex) => (
        <IngredientEditor
          key={ing.localId}
          ingredient={ing}
          testIDBase={`g${groupIndex}-i${ingIndex}`}
          canRemove={group.ingredients.length > 1}
          canUp={ingIndex > 0}
          canDown={ingIndex < group.ingredients.length - 1}
          autoFocus={ing.localId === lastAddedRowId}
          unitOptions={unitOptions}
          otherGroups={otherGroups}
          error={errors.ingredients[ing.localId]}
          onChangeField={(field, value) =>
            dispatch({
              type: "setIngredientField",
              groupId: group.localId,
              ingredientId: ing.localId,
              field,
              value,
            })
          }
          onRemove={() =>
            dispatch({
              type: "removeIngredient",
              groupId: group.localId,
              ingredientId: ing.localId,
            })
          }
          onMove={(direction) =>
            dispatch({
              type: "moveIngredient",
              groupId: group.localId,
              ingredientId: ing.localId,
              direction,
            })
          }
          onMoveToGroup={(toGroupId) =>
            dispatch({ type: "moveIngredientToGroup", ingredientId: ing.localId, toGroupId })
          }
          onOpenPicker={() => onOpenPicker(ing.localId)}
          onUnlink={() => dispatch({ type: "unlinkRefRecipe", ingredientId: ing.localId })}
        />
      ))}

      <Pressable
        testID={`group-${groupIndex}-add-ingredient`}
        onPress={() => dispatch({ type: "addIngredient", groupId: group.localId })}
        accessibilityRole="button"
        className="self-start rounded-lg border border-neutral-200 px-2 py-1"
      >
        <Text className="text-xs text-neutral-600">＋ 材料を追加</Text>
      </Pressable>
    </View>
  );
}

// --- 材料行 1 つ ------------------------------------------------

function IngredientEditor({
  ingredient,
  testIDBase,
  canRemove,
  canUp,
  canDown,
  autoFocus,
  unitOptions,
  otherGroups,
  error,
  onChangeField,
  onRemove,
  onMove,
  onMoveToGroup,
  onOpenPicker,
  onUnlink,
}: {
  ingredient: IngredientRow;
  testIDBase: string;
  canRemove: boolean;
  canUp: boolean;
  canDown: boolean;
  autoFocus: boolean;
  unitOptions: { value: string; placement: string }[];
  otherGroups: GroupRow[];
  error?: string;
  onChangeField: (field: "name" | "quantity" | "unit", value: string) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  onMoveToGroup: (toGroupId: string) => void;
  onOpenPicker: () => void;
  onUnlink: () => void;
}) {
  const nameRef = useRef<RNTextInput>(null);
  const [showUnitList, setShowUnitList] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);

  useEffect(() => {
    if (autoFocus) nameRef.current?.focus();
  }, [autoFocus]);

  const matchedUnit = unitOptions.find((u) => u.value === ingredient.unit);
  const placement = (matchedUnit?.placement ?? "suffix") as Placement;
  const preview = formatQuantity({
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    placement,
  });
  // 入力中は前方一致で絞り込む（features/unit.md §2）。空なら全件。
  const filteredUnits =
    ingredient.unit.trim() === ""
      ? unitOptions
      : unitOptions.filter((u) => u.value.startsWith(ingredient.unit.trim()));

  // 「▼ や候補を押した」ことを記録し、その直後に来る入力欄の blur では
  // 候補を閉じないようにする。ref にするのは、blur と押下の間で再描画を
  // 挟まずに読み書きしたいため。
  const pressingUnitControl = useRef(false);
  // 実ブラウザのポインタ操作は `pressIn → pressOut → press` の順で来る。
  // `pressOut` まで来た押下だけを `press` と対にして、`pressIn` での反転を
  // 二重に行わない。時間を使わないので、長押しでも同じ操作として扱える。
  // `pressIn` だけで途切れた場合は記録を「対になる press」とみなさず、次の
  // `press` で消費して反転する。キーボード / スクリーンリーダー操作の press
  // だけは記録がないので、そのまま反転する。
  const unitTogglePressPhase = useRef<"idle" | "pressedIn" | "pressedOut">("idle");

  function handleUnitBlur() {
    if (pressingUnitControl.current) {
      pressingUnitControl.current = false;
      return; // 自分の候補 UI を押しただけなので閉じない
    }
    setShowUnitList(false);
  }

  function selectUnit(value: string) {
    pressingUnitControl.current = false;
    onChangeField("unit", value);
    setShowUnitList(false);
  }

  return (
    <View className="gap-1 rounded-lg bg-neutral-50 p-2">
      <View className="flex-row items-center gap-1">
        <TextInput
          ref={nameRef}
          testID={`${testIDBase}-name`}
          value={ingredient.name}
          onChangeText={(v) => onChangeField("name", v)}
          autoFocus={autoFocus}
          placeholder="材料名"
          className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm"
        />
        <TextInput
          testID={`${testIDBase}-quantity`}
          value={ingredient.quantity}
          onChangeText={(v) => onChangeField("quantity", v)}
          placeholder="数量"
          keyboardType="decimal-pad"
          className="w-16 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm"
        />
        {/* 単位は「自由入力 ＋ 候補から選ぶ」の両方ができる（features/unit.md §2）。
            右の「▼」で候補一覧を開閉する。ボタン経由なら入力欄にフォーカスが
            移らないので、スマホでキーボードを出さずに一覧から選べる。 */}
        <View className="flex-row items-center">
          <TextInput
            testID={`${testIDBase}-unit`}
            value={ingredient.unit}
            onChangeText={(v) => {
              onChangeField("unit", v);
              setShowUnitList(true);
            }}
            onFocus={() => {
              // フォーカスのたびに状態をまっさらにする（取りこぼした ref が
              // 次の blur を食べてしまわないように）。
              pressingUnitControl.current = false;
              setShowUnitList(true);
            }}
            onBlur={handleUnitBlur}
            placeholder="単位"
            className="w-14 rounded-l border border-r-0 border-neutral-200 bg-white px-2 py-1.5 text-sm"
          />
          <Pressable
            testID={`${testIDBase}-unit-toggle`}
            // ## この 2 つの指定はセットで必要（実測で確認済み）
            //
            // **`onPressIn` で開閉する**理由:
            // react-native-web の responder は `blur` を capture phase で拾って
            // 進行中の押下を打ち切る（ResponderSystem.js の documentEventsCapturePhase）。
            // 入力欄にフォーカスがある状態で押すと `onPress`（押し切り）は届かない。
            // `onPressIn` は mousedown の時点で走るので blur より先に発火する。
            //
            // **`onPress` 側でも分岐する**理由:
            // 押し始めの通知は既定で 50ms 遅延される（DEFAULT_PRESS_DELAY_MS）。
            // 素早いクリックはその前に指が離れるので「遅延中に離された」経路に入るが、
            // キーボードやスクリーンリーダーから実行すると onPressIn が来ない
            // 経路があるため、その場合は onPress で開閉する必要がある。
            // ポインタ操作では両方が来るので、pressOut の記録で対になる press か確認する。
            onPressIn={() => {
              unitTogglePressPhase.current = "pressedIn";
              pressingUnitControl.current = true;
              setShowUnitList((open) => !open);
            }}
            onPressOut={() => {
              if (unitTogglePressPhase.current === "pressedIn") {
                unitTogglePressPhase.current = "pressedOut";
              }
            }}
            onPress={() => {
              const pressPhase = unitTogglePressPhase.current;
              unitTogglePressPhase.current = "idle";
              if (pressPhase !== "pressedOut") setShowUnitList((open) => !open);
            }}
            accessibilityRole="button"
            accessibilityLabel="単位の候補を開閉"
            className="rounded-r border border-neutral-200 bg-neutral-100 px-1.5 py-1.5"
          >
            <Text className="text-xs text-neutral-600">▼</Text>
          </Pressable>
        </View>
      </View>

      {/* 候補一覧（プルダウン）。選ぶと単位欄に入る。
          件数が多い（初期シードで 20 件以上）ので高さを抑えてスクロールさせる。
          `nestedScrollEnabled` は Android で外側の ScrollView に指を取られて
          内側がスクロールしないのを防ぐために必要。 */}
      {showUnitList && filteredUnits.length > 0 && (
        <View
          testID={`${testIDBase}-unit-list`}
          className="overflow-hidden rounded border border-neutral-300 bg-white"
        >
          <ScrollView
            style={{ maxHeight: 176 }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="always"
          >
            {filteredUnits.map((u, i) => (
              <Pressable
                key={u.value}
                testID={`${testIDBase}-unit-option-${u.value}`}
                // ▼ と同じ理由で `onPressIn`。押すと入力欄の blur が走って候補が
                // 画面から消えるため、`onPress`（押し切り）では届かない。
                // 下の `onPress` は「素早いクリックでも onPressIn を配送させる」ために
                // 必要（▼ のコメント参照）。値を入れるだけなので両方走っても同じ結果。
                onPressIn={() => {
                  pressingUnitControl.current = true;
                  selectUnit(u.value);
                }}
                // キーボード操作（Enter）では onPressIn が発火しないので併記する。
                // 同じ値を入れるだけなので、両方走っても結果は変わらない。
                onPress={() => selectUnit(u.value)}
                className={`px-3 py-2 ${i > 0 ? "border-t border-neutral-100" : ""}`}
              >
                <Text className="text-sm text-neutral-800">
                  {u.value}
                  {/* 大さじ・小さじは数量より前に置く単位なので、選ぶ前に分かるようにする。 */}
                  {u.placement === "prefix" && (
                    <Text className="text-xs text-neutral-400">　例: {u.value} 2</Text>
                  )}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {preview !== "" && (
        <Text testID={`${testIDBase}-preview`} className="text-xs text-neutral-500">
          プレビュー: {ingredient.name || "材料"} {preview}
        </Text>
      )}

      <View className="flex-row items-center gap-2">
        {ingredient.refRecipeId ? (
          <Pressable testID={`${testIDBase}-unlink`} onPress={onUnlink} accessibilityRole="button">
            <Text className="text-xs text-orange-600">🔗 {ingredient.refRecipeTitle}（解除）</Text>
          </Pressable>
        ) : (
          <Pressable
            testID={`${testIDBase}-pick-recipe`}
            onPress={onOpenPicker}
            accessibilityRole="button"
          >
            <Text className="text-xs text-neutral-500">レシピから選ぶ</Text>
          </Pressable>
        )}

        <MoveButtons
          testIDPrefix={testIDBase}
          canUp={canUp}
          canDown={canDown}
          onUp={() => onMove("up")}
          onDown={() => onMove("down")}
        />

        {otherGroups.length > 0 && canRemove && (
          <Pressable
            testID={`${testIDBase}-move-group`}
            onPress={() => setShowGroupMenu((v) => !v)}
            accessibilityRole="button"
          >
            <Text className="text-xs text-neutral-500">別グループへ</Text>
          </Pressable>
        )}

        {canRemove && (
          <Pressable testID={`${testIDBase}-remove`} onPress={onRemove} accessibilityRole="button">
            <Text className="text-xs text-red-600">削除</Text>
          </Pressable>
        )}
      </View>

      {showGroupMenu &&
        otherGroups.map((g, i) => (
          <Pressable
            key={g.localId}
            testID={`${testIDBase}-move-to-${i}`}
            onPress={() => {
              onMoveToGroup(g.localId);
              setShowGroupMenu(false);
            }}
            className="rounded bg-neutral-100 px-2 py-1"
          >
            <Text className="text-xs text-neutral-700">
              → {g.name.trim() || "名前なしグループ"}
            </Text>
          </Pressable>
        ))}

      {error && <Text className="text-sm text-red-600">{error}</Text>}
    </View>
  );
}

// --- 手順行 1 つ ------------------------------------------------

function StepEditor({
  step,
  index,
  stepCount,
  lastAddedRowId,
  error,
  dispatch,
  onImageUploadingChange,
}: {
  step: StepRow;
  index: number;
  stepCount: number;
  lastAddedRowId: string | null;
  error?: string;
  dispatch: Dispatch;
  onImageUploadingChange: (imageId: string, uploading: boolean) => void;
}) {
  const ref = useRef<RNTextInput>(null);
  const autoFocus = step.localId === lastAddedRowId;
  const handleUploadingChange = useCallback(
    (uploading: boolean) => onImageUploadingChange(step.localId, uploading),
    [onImageUploadingChange, step.localId],
  );

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <View className="gap-1 rounded-lg bg-neutral-50 p-2">
      <View className="flex-row items-start gap-2">
        <Text className="pt-2 text-sm font-bold text-neutral-500">{index + 1}.</Text>
        <TextInput
          ref={ref}
          testID={`step-${index}-body`}
          value={step.body}
          onChangeText={(v) => dispatch({ type: "setStepBody", stepId: step.localId, value: v })}
          autoFocus={autoFocus}
          placeholder="手順の説明"
          multiline
          className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm"
        />
      </View>

      {/* 手順画像（1 手順に 1 枚・任意）。本文の下に置く（screens/recipe-editor.md §5）。 */}
      <View className="pl-6">
        <ImagePickerField
          testID={`step-${index}-image`}
          variant="step"
          imageKey={step.imageKey}
          imageUrl={step.imageUrl}
          onChange={(key, url) =>
            dispatch({ type: "setStepImageKey", stepId: step.localId, key, url })
          }
          onUploadingChange={handleUploadingChange}
        />
      </View>

      <View className="flex-row items-center gap-2 pl-6">
        <MoveButtons
          testIDPrefix={`step-${index}`}
          canUp={index > 0}
          canDown={index < stepCount - 1}
          onUp={() => dispatch({ type: "moveStep", stepId: step.localId, direction: "up" })}
          onDown={() => dispatch({ type: "moveStep", stepId: step.localId, direction: "down" })}
        />
        {stepCount > 1 && (
          <Pressable
            testID={`step-${index}-remove`}
            onPress={() => dispatch({ type: "removeStep", stepId: step.localId })}
            accessibilityRole="button"
          >
            <Text className="text-xs text-red-600">削除</Text>
          </Pressable>
        )}
      </View>
      {error && <Text className="text-sm text-red-600">{error}</Text>}
    </View>
  );
}

function MoveButtons({
  testIDPrefix,
  canUp,
  canDown,
  onUp,
  onDown,
}: {
  testIDPrefix: string;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <View className="flex-row gap-1">
      <Pressable
        testID={`${testIDPrefix}-move-up`}
        onPress={onUp}
        disabled={!canUp}
        accessibilityRole="button"
        accessibilityLabel="上へ移動"
      >
        <Text className={`px-1 text-sm ${canUp ? "text-neutral-600" : "text-neutral-300"}`}>↑</Text>
      </Pressable>
      <Pressable
        testID={`${testIDPrefix}-move-down`}
        onPress={onDown}
        disabled={!canDown}
        accessibilityRole="button"
        accessibilityLabel="下へ移動"
      >
        <Text className={`px-1 text-sm ${canDown ? "text-neutral-600" : "text-neutral-300"}`}>
          ↓
        </Text>
      </Pressable>
    </View>
  );
}
