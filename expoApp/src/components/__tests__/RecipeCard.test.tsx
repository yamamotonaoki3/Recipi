/**
 * RecipeCard のテスト（自分 / 他人のレシピ一覧のカード。Issue #100 でお気に入り数を追加）。
 */
import { fireEvent, render } from "@testing-library/react-native";

import { RecipeCard } from "../RecipeCard";

const recipe = {
  id: "r1",
  title: "[E2E_TEST] テストカレー",
  thumbnailUrl: null,
  author: { id: "u1", displayName: "testuser_001", avatarUrl: null },
  favoriteCount: 4,
  isFavorited: false,
  isPublic: true,
  createdAt: "2026-09-01T00:00:00Z",
};

describe("RecipeCard", () => {
  it("お気に入り数（♡ + 数）を出す", async () => {
    const { getByTestId } = await render(
      <RecipeCard testID="card" recipe={recipe} onPress={jest.fn()} />,
    );
    expect(getByTestId("card-favorite-count").props.children).toEqual(["♡ ", 4]);
  });

  it("非公開のレシピには「非公開」バッジを出す", async () => {
    const { getByTestId, rerender, queryByTestId } = await render(
      <RecipeCard testID="card" recipe={recipe} onPress={jest.fn()} />,
    );
    expect(queryByTestId("card-private-badge")).toBeNull();

    await rerender(
      <RecipeCard testID="card" recipe={{ ...recipe, isPublic: false }} onPress={jest.fn()} />,
    );
    expect(getByTestId("card-private-badge")).toBeTruthy();
  });

  it("タップで onPress を呼ぶ", async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <RecipeCard testID="card" recipe={recipe} onPress={onPress} />,
    );
    await fireEvent.press(getByTestId("card"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
