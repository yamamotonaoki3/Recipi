/** Tailwind（NativeWind）の設定。
 *  `content` に指定したファイルの中で使われた className を検出して、
 *  必要な CSS だけを生成する。 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
};
