/**
 * PasswordField のテスト（BB: トグルで表示/非表示を切り替えられる）。
 *
 * @testing-library/react-native v14 は React 19 の Concurrent Rendering に
 * 合わせて `render` / `fireEvent.press` などが軒並み非同期関数になっている。
 * 必ず `await` すること（忘れると呼び出しが実際には反映されないまま次の
 * assertion に進んでしまい、原因が分かりにくいテスト失敗になる）。
 */
import { fireEvent, render } from "@testing-library/react-native";

import { PasswordField } from "./PasswordField";

describe("PasswordField", () => {
  it("初期状態は非表示（secureTextEntry=true）", async () => {
    const { getByTestId } = await render(
      <PasswordField testID="password" value="secret" onChangeText={() => {}} />,
    );
    expect(getByTestId("password").props.secureTextEntry).toBe(true);
  });

  it("トグルを押すと表示される", async () => {
    const { getByTestId } = await render(
      <PasswordField testID="password" value="secret" onChangeText={() => {}} />,
    );
    await fireEvent.press(getByTestId("password-toggle"));
    expect(getByTestId("password").props.secureTextEntry).toBe(false);
  });

  it("もう一度押すと非表示に戻る", async () => {
    const { getByTestId } = await render(
      <PasswordField testID="password" value="secret" onChangeText={() => {}} />,
    );
    await fireEvent.press(getByTestId("password-toggle"));
    await fireEvent.press(getByTestId("password-toggle"));
    expect(getByTestId("password").props.secureTextEntry).toBe(true);
  });

  it("errorMessage を渡すと表示される", async () => {
    const { findByText } = await render(
      <PasswordField
        testID="password"
        value=""
        onChangeText={() => {}}
        errorMessage="パスワードを入力してください"
      />,
    );
    expect(await findByText("パスワードを入力してください")).toBeTruthy();
  });
});
