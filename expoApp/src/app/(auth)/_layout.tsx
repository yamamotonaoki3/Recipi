/**
 * 未ログイン用のスタック（ログイン / サインアップ / パスワードリセット）。
 * Expo Router の「ルートグループ」（括弧付きディレクトリ）はパスに
 * 現れず、画面をグループ分けするためだけに使う。
 *
 * ここには認可ゲートを付けない（未ログインでも見られる画面群のため）。
 *
 * 【セーフエリアをここでまとめて確保する理由（Issue #74）】
 * `targetSdk 36` の edge-to-edge では、画面はステータスバー / ナビゲーション
 * バーの裏まで広がる。避けないと上端はフォームの先頭がステータスバーに潜り、
 * 下端はコンテンツ末尾の約 48dp がナビゲーションバーの下から出てこない
 * （サインアップ画面では送信ボタンの下の「ログインへ」リンクが隠れていた）。
 *
 * 3 画面それぞれに書くのではなくスタックごと包むのは、1 か所で済み、
 * 今後この配下に画面が増えても自動で効くため。ログイン後の画面は
 * `(tabs)/_layout.tsx` のボトムナビが下端 inset を持つので対象外
 * （足すと二重になる）。
 */
import { Stack } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function AuthLayout() {
  const insets = useSafeAreaInsets();

  return (
    <View
      // セーフエリアの inset 領域も白で塗り、上下にウィンドウ背景の帯が見えないようにする。
      className="bg-white"
      testID="auth-screen"
      style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}
