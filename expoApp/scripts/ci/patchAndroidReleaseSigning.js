#!/usr/bin/env node
/**
 * リリースワークフロー（.github/workflows/release.yml）専用。
 * `expo prebuild`が生成した android/app/build.gradle を書き換え、
 * releaseビルドタイプの署名をdebug鍵からrelease鍵（gradle.propertiesに
 * 設定したRECIPI_RELEASE_*）へ差し替える。
 *
 * 前提: android/app/build.gradle には既に
 *   signingConfigs { debug { ... } }
 *   buildTypes { release { ... signingConfig signingConfigs.debug ... } }
 * が生成済み（expo prebuildの既定テンプレート）。
 *
 * 使い方: node scripts/ci/patchAndroidReleaseSigning.js
 */
const fs = require("fs");
const path = require("path");

const buildGradlePath = path.join(__dirname, "..", "..", "android", "app", "build.gradle");
let src = fs.readFileSync(buildGradlePath, "utf8");

const releaseSigningConfig = `
        release {
            storeFile file(RECIPI_RELEASE_STORE_FILE)
            storePassword RECIPI_RELEASE_STORE_PASSWORD
            keyAlias RECIPI_RELEASE_KEY_ALIAS
            keyPassword RECIPI_RELEASE_KEY_PASSWORD
        }`;

if (!src.includes("signingConfigs {")) {
  throw new Error("signingConfigs block not found in build.gradle");
}
src = src.replace(/signingConfigs \{/, "signingConfigs {" + releaseSigningConfig);

const before = src;
// buildTypes.release ブロック内の signingConfig 参照だけを差し替える
// （debug buildTypeには触れない）。release {...} の最初の閉じ括弧までを
// 対象にする（このプロジェクトのbuild.gradleにはネストした{}が無い前提）。
src = src.replace(
  /(release \{[^}]*?)signingConfig signingConfigs\.debug/,
  "$1signingConfig signingConfigs.release",
);
if (src === before) {
  throw new Error("release buildType signingConfig reference not found/replaced");
}

fs.writeFileSync(buildGradlePath, src);
console.log("android/app/build.gradle: release buildType now uses signingConfigs.release");
