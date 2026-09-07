/**
 * レシピ作成 / 編集の共有コンポーネント（screens/recipe-editor.md）。
 *
 * - フォーム状態は useRecipeForm（recipeForm.ts の reducer）。
 * - 行編集 UX: 「+」で末尾に空行を足してそこへフォーカス、行削除で番号詰め、
 *   「↑ / ↓」で並べ替え（ドラッグは将来。todo #21）。
 * - 単位欄は GET /units の候補を前方一致で絞るオートコンプリート ＋
 *   formatQuantity のプレビュー。
 * - 未保存で閉じようとしたら確認ダイアログ（useUnsavedChangesGuard）。
 * - 画像入力は Phase 3（#40）で追加するので、この画面には無い。
 */
import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
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

  const guard = useUnsavedChangesGuard(dirty, leaveEditor);

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

    const submission = buildSubmission(state);
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
      {/* 未保存の変更があるあいだは iOS モーダルのスワイプ down を無効化する
          （スワイプで閉じると requestClose を通らず確認ダイアログが出ないため。
          Android のハードウェアバックは useUnsavedChangesGuard が横取りする）。 */}
      <Stack.Screen options={{ gestureEnabled: !dirty }} />

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
        <Pressable
          testID="editor-save"
          onPress={handleSave}
          disabled={save.isPending}
          accessibilityRole="button"
        >
          <Text className="font-semibold text-orange-600">
            {save.isPending ? "保存中…" : "保存"}
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
        message="保存していない変更は失われます。"
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
  const filteredUnits =
    ingredient.unit.trim() === ""
      ? unitOptions
      : unitOptions.filter((u) => u.value.startsWith(ingredient.unit.trim()));

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
        <TextInput
          testID={`${testIDBase}-unit`}
          value={ingredient.unit}
          onChangeText={(v) => {
            onChangeField("unit", v);
            setShowUnitList(true);
          }}
          onFocus={() => setShowUnitList(true)}
          onBlur={() => setShowUnitList(false)}
          placeholder="単位"
          className="w-16 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm"
        />
      </View>

      {showUnitList && filteredUnits.length > 0 && (
        <View className="flex-row flex-wrap gap-1">
          {filteredUnits.slice(0, 8).map((u) => (
            <Pressable
              key={u.value}
              testID={`${testIDBase}-unit-option-${u.value}`}
              onPress={() => {
                onChangeField("unit", u.value);
                setShowUnitList(false);
              }}
              className="rounded bg-neutral-200 px-2 py-0.5"
            >
              <Text className="text-xs text-neutral-700">{u.value}</Text>
            </Pressable>
          ))}
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
}: {
  step: StepRow;
  index: number;
  stepCount: number;
  lastAddedRowId: string | null;
  error?: string;
  dispatch: Dispatch;
}) {
  const ref = useRef<RNTextInput>(null);
  const autoFocus = step.localId === lastAddedRowId;

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
