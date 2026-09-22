#!/usr/bin/env node
/**
 * リリースワークフロー（.github/workflows/release.yml）専用。
 * app.jsonのandroid.versionCodeを、タグから計算した値へ書き換える。
 *
 * 使い方: node scripts/ci/patchAndroidVersionCode.js <versionCode>
 */
const fs = require("fs");
const path = require("path");

const versionCode = Number(process.argv[2]);
if (!Number.isInteger(versionCode) || versionCode <= 0) {
  throw new Error(`invalid versionCode: ${process.argv[2]}`);
}

const appJsonPath = path.join(__dirname, "..", "..", "app.json");
const json = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
json.expo.android.versionCode = versionCode;
fs.writeFileSync(appJsonPath, JSON.stringify(json, null, 2) + "\n");
console.log(`app.json android.versionCode -> ${versionCode}`);
