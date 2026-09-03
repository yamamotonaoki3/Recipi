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
