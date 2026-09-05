// ESLint（コードの誤り・スタイルの検出）の設定。フラットコンフィグ形式。
// - eslint-config-expo: Expo 標準のルール一式
// - eslint-config-prettier: Prettier と競合するスタイル系ルールを無効化
//   （フォーマットは Prettier に任せ、ESLint は「バグになりやすい書き方」に集中）
const expoConfig = require("eslint-config-expo/flat");
const prettier = require("eslint-config-prettier");

module.exports = [
  ...expoConfig,
  prettier,
  {
    // 型情報を使った厳格ルール。対象は .ts/.tsx のみ（設定系の .js ファイルは対象外）。
    // projectService: true にすると、型チェック（tsc）と同じ型情報を ESLint にも渡せる。
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // async 関数の呼び出し結果（Promise）を await も .catch() もせず放置するとエラーにする。
      // 例: useMutation の mutateAsync() を await し忘れる、useEffect 内で async 関数を呼びっぱなしにする等。
      "@typescript-eslint/no-floating-promises": "error",
      // any 型の明示的な使用を禁止する。型チェックを迂回する書き方を防ぎ、
      // 生成済みの型（src/api/schema.ts）や unknown ＋ 型ガードで正しく書くよう促す。
      "@typescript-eslint/no-explicit-any": "error",
      // useEffect / useCallback / useMemo 等の依存配列の書き漏れを警告ではなくエラーにする。
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    ignores: [
      "dist/*",
      "coverage/*",
      "src/api/schema.ts",
      ".expo/*",
      "src-tauri/**",
      "expo-env.d.ts",
      "nativewind-env.d.ts",
    ],
  },
];
