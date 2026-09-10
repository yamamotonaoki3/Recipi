/** QueryProvider の描画と、セッションが切れたときのキャッシュ破棄。 */
import { useQueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { QueryProvider } from "./QueryProvider";
import { useSession } from "@/store/session";

beforeEach(() => {
  useSession.getState().clear();
});

it("子要素を描画する", async () => {
  await render(
    <QueryProvider>
      <Text>こんにちは</Text>
    </QueryProvider>,
  );
  expect(screen.getByText("こんにちは")).toBeOnTheScreen();
});

/**
 * セッションが切れる経路は「ログアウトボタン」だけではない（トークン失効・
 * `token_version` 不一致・アカウント削除では `api/client.ts` が直接
 * セッションを消す）。どの経路でも前のユーザーのデータが残らないことを、
 * **状態の変化**を起点に確かめる（Codex #42 レビュー指摘）。
 */
it("ログイン状態が外れたらキャッシュを全部捨てる", async () => {
  let client: ReturnType<typeof useQueryClient> | undefined;
  function Probe() {
    client = useQueryClient();
    return <Text>probe</Text>;
  }

  useSession.setState({ isAuthenticated: true });
  await render(
    <QueryProvider>
      <Probe />
    </QueryProvider>,
  );

  client?.setQueryData(["history", "u1"], { secret: true });
  expect(client?.getQueryData(["history", "u1"])).toBeTruthy();

  // 強制ログアウト相当（client.ts の clearSessionAndStorage と同じ状態変化）。
  await act(async () => {
    useSession.getState().clear();
  });

  await waitFor(() => expect(client?.getQueryData(["history", "u1"])).toBeUndefined());
});

it("ログイン済みのまま別ユーザーに切り替わってもキャッシュを捨てる", async () => {
  let client: ReturnType<typeof useQueryClient> | undefined;
  function Probe() {
    client = useQueryClient();
    return <Text>probe</Text>;
  }

  useSession.setState({ isAuthenticated: true, user: { id: "u1", displayName: "A" } });
  await render(
    <QueryProvider>
      <Probe />
    </QueryProvider>,
  );

  client?.setQueryData(["recipe", "r1"], { secret: true });

  // ログアウトを挟まずに別アカウントでログインし直した状況。
  await act(async () => {
    useSession.setState({ isAuthenticated: true, user: { id: "u2", displayName: "B" } });
  });

  await waitFor(() => expect(client?.getQueryData(["recipe", "r1"])).toBeUndefined());
});
