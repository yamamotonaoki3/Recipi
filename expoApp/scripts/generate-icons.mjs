// アプリアイコン生成スクリプト
//
// design/icons/ に置いたマスター画像から、Expo（iOS / Android / Web）と
// Tauri（Windows / macOS）が必要とする各サイズの画像を作る。
// 使い方: expoApp ディレクトリで `npm run gen:icons`
//
// Node.js の ES Modules（.mjs）で書いている。`import` で他のモジュールを読み込み、
// 上から下へ順に実行される普通のスクリプト。

import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

// import.meta.url はこのファイル自身の URL。そこから expoApp/ と リポジトリルートを求める。
// （スクリプトをどこから実行しても同じパスになるようにするための定番の書き方）
const scriptDir = dirname(fileURLToPath(import.meta.url));
const expoAppDir = resolve(scriptDir, "..");
const repoRoot = resolve(expoAppDir, "..");

const sourceDir = join(repoRoot, "design", "icons");
const assetsDir = join(expoAppDir, "assets", "images");
const tauriIconsDir = join(expoAppDir, "src-tauri", "icons");

// マスター画像に求める最小の一辺。1024px は iOS のアプリアイコンと
// Tauri のアイコン生成が必要とするサイズ。
const REQUIRED_SIZE = 1024;

// Android アダプティブアイコンのセーフゾーン。前景の主要要素は中央 66% に収める必要がある。
// （端末ごとに円・角丸四角などへ切り抜かれるため）
const ADAPTIVE_SAFE_RATIO = 0.66;

// macOS のアプリアイコンの余白と角丸。
// macOS は iOS や Android と違って**アイコンを自動で角丸にしない**ため、
// 角丸と周囲の余白を画像側に描き込む必要がある（描かないと Dock で四角く出る）。
// 数値は Apple の macOS アイコンのグリッドに合わせたもの:
// 1024px のキャンバスに対して、絵は 824x824、角丸の半径は 185.4。
const MACOS_CANVAS = 1024;
const MACOS_ARTWORK = 824;
const MACOS_CORNER_RADIUS = 185.4;

/** 処理を中断してユーザーに対処法を伝える。 */
function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/**
 * マスター画像を 1 枚読み込んで検証する。
 * optional=true のファイルは無ければ null を返す（呼び出し側で代替する）。
 * requireMasterSize=false のファイルは、壊れた画像かどうかだけを sharp の metadata() で確認する。
 */
async function loadSource(fileName, { optional = false, requireMasterSize = true } = {}) {
  const filePath = join(sourceDir, fileName);

  if (!existsSync(filePath)) {
    if (optional) return null;
    fail(
      `マスター画像が見つかりません: ${relative(repoRoot, filePath)}\n` +
        `  ${REQUIRED_SIZE}x${REQUIRED_SIZE} の正方形 PNG を上記のパスに置いてから、もう一度実行してください。\n` +
        `  仕様は design/icons/README.md を参照。`,
    );
  }

  const image = sharp(filePath);
  const { width, height } = await image.metadata();

  if (!requireMasterSize) {
    return filePath;
  }

  if (width !== height) {
    fail(
      `${fileName} が正方形ではありません（${width}x${height}）。\n` +
        `  アイコンは正方形である必要があります。${REQUIRED_SIZE}x${REQUIRED_SIZE} で書き出してください。`,
    );
  }
  if (width < REQUIRED_SIZE) {
    fail(
      `${fileName} が小さすぎます（${width}x${height}）。\n` +
        `  拡大すると画質が落ちるため、${REQUIRED_SIZE}x${REQUIRED_SIZE} 以上で書き出してください。`,
    );
  }

  return filePath;
}

/** app.json からアダプティブアイコンの背景色を読む（色の二重管理を避けるため）。 */
async function readAdaptiveBackgroundColor() {
  const appJsonPath = join(expoAppDir, "app.json");
  const appJson = JSON.parse(await readFile(appJsonPath, "utf8"));
  const color = appJson?.expo?.android?.adaptiveIcon?.backgroundColor;

  if (typeof color !== "string") {
    fail(
      `app.json の expo.android.adaptiveIcon.backgroundColor が読み取れませんでした。\n` +
        `  ${relative(repoRoot, appJsonPath)} を確認してください。`,
    );
  }
  return color;
}

/**
 * 画像を size x size に収め、余った部分を透明な余白で埋める。
 * fit: "contain" は縦横比を保ったまま指定サイズに収める指定。
 */
function fitTransparent(input, size) {
  return sharp(input).resize(size, size, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
}

/**
 * 画像のうち「透明ではない部分」が占める範囲（バウンディングボックス）を求める。
 * 透過 PNG の周りにどれだけ余白が入っているかを知るために使う。
 * 透過を持たない画像は、画像全体が中身であるとみなす。
 */
async function measureOpaqueBounds(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      // 1 ピクセルは RGBA の 4 バイト。その 4 バイト目（+3）がアルファ（不透明度）。
      // わずかなノイズを拾わないよう、ほぼ透明（10 以下）は余白として扱う。
      if (data[(y * info.width + x) * 4 + 3] <= 10) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  // 全ピクセルが透明だった場合は、切り出しようがないので画像全体を返す。
  if (right < 0) {
    return { left: 0, top: 0, width: info.width, height: info.height };
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * アダプティブアイコンの前景を作る。
 *
 * Android は端末ごとに前景を円・角丸四角へ切り抜くため、中身は
 * セーフゾーン（中央 66%）に収まっている必要がある。
 * 元画像の余白の入り方は素材によってまちまちなので、
 * 「透明な余白をいったん取り除いてから、セーフゾーンに合わせて置き直す」。
 * こうすると、余白込みで書き出された素材でも、ぴったり詰まった素材でも同じ結果になる
 * （すでにセーフゾーンを考慮済みの素材を二重に縮小してしまうことがない）。
 */
async function buildAdaptiveForeground(input, size) {
  const innerSize = Math.round(size * ADAPTIVE_SAFE_RATIO);
  const bounds = await measureOpaqueBounds(input);

  // 透明な余白を取り除いた中身だけを、セーフゾーンの大きさに収める
  const inner = await fitTransparent(await sharp(input).extract(bounds).png().toBuffer(), innerSize)
    .png()
    .toBuffer();
  const padding = Math.round((size - innerSize) / 2);

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: inner, top: padding, left: padding }]);
}

/**
 * macOS のアプリアイコン用に、角丸（スクワークル）と周囲の余白を描き込んだ画像を作る。
 * Windows やモバイルは OS 側が形を整えるのでこの処理は要らない（macOS だけの都合）。
 */
async function buildMacosIcon(input) {
  // 絵の部分を 824x824 に縮め、角丸で切り抜く
  const rounded = await sharp(input)
    .resize(MACOS_ARTWORK, MACOS_ARTWORK, { fit: "cover" })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${MACOS_ARTWORK}" height="${MACOS_ARTWORK}">` +
            `<rect width="${MACOS_ARTWORK}" height="${MACOS_ARTWORK}" ` +
            `rx="${MACOS_CORNER_RADIUS}" ry="${MACOS_CORNER_RADIUS}" fill="#fff"/></svg>`,
        ),
        // dest-in は「重ねた画像の不透明な部分だけを残す」合成。角の外側が透明になる。
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();

  // 1024x1024 の透明なキャンバスの中央に置く（周囲が余白になる）
  const offset = Math.round((MACOS_CANVAS - MACOS_ARTWORK) / 2);
  return sharp({
    create: {
      width: MACOS_CANVAS,
      height: MACOS_CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: rounded, top: offset, left: offset }])
    .png()
    .toBuffer();
}

async function main() {
  // 1. マスター画像を読む（前景・スプラッシュは省略可）
  const appIcon = await loadSource("app-icon.png");
  const foregroundSource = await loadSource("app-icon-foreground.png", { optional: true });

  // スプラッシュは背景色の上に置くので、背景が透過しているロゴが望ましい。
  // 専用画像が無い場合は、透過のロゴである前景画像 → それも無ければ app-icon.png の順で代用する。
  const splashSource =
    (await loadSource("splash-icon.png", {
      optional: true,
      requireMasterSize: false,
    })) ??
    foregroundSource ??
    appIcon;

  const backgroundColor = await readAdaptiveBackgroundColor();
  await mkdir(assetsDir, { recursive: true });

  // 2. Expo 用の画像を生成する
  // iOS / 汎用アプリアイコン。透過だと iOS で黒く出るため、背景色で塗りつぶして不透明にする。
  await sharp(appIcon)
    .resize(REQUIRED_SIZE, REQUIRED_SIZE, { fit: "contain", background: backgroundColor })
    .flatten({ background: backgroundColor })
    .png()
    .toFile(join(assetsDir, "icon.png"));

  // Web のファビコン（ブラウザのタブに出る小さいアイコン）
  await fitTransparent(appIcon, 48).png().toFile(join(assetsDir, "favicon.png"));

  // Android アダプティブアイコンの前景（セーフゾーンに収めた透過画像）。
  // 専用画像が無ければ app-icon.png から代用する。
  const foreground = await buildAdaptiveForeground(foregroundSource ?? appIcon, 512);
  const foregroundBuffer = await foreground.png().toBuffer();
  await writeFile(join(assetsDir, "android-icon-foreground.png"), foregroundBuffer);

  // 同 背景（単色の塗り。色は app.json から読んだ値）
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: backgroundColor },
  })
    .png()
    .toFile(join(assetsDir, "android-icon-background.png"));

  // 同 モノクロ版（Android 13+ のテーマアイコン用。前景をグレースケール化して縮小）
  await sharp(foregroundBuffer)
    .resize(432, 432)
    .grayscale()
    .png()
    .toFile(join(assetsDir, "android-icon-monochrome.png"));

  // スプラッシュのロゴ（透過を保つ。背景色は app.json の expo-splash-screen 設定側で付く）
  await fitTransparent(splashSource, 512).png().toFile(join(assetsDir, "splash-icon.png"));

  console.log(`✔ Expo 用アイコンを生成しました: ${relative(repoRoot, assetsDir)}`);

  // 3. Tauri（デスクトップ）用の一式を生成する。
  //    .ico / .icns まで作る必要があるため、Tauri CLI の icon サブコマンドに任せる。
  //    （@tauri-apps/cli は既に devDependency に入っているので追加インストールは不要）
  const tauriCli = join(expoAppDir, "node_modules", "@tauri-apps", "cli", "tauri.js");
  execFileSync(process.execPath, [tauriCli, "icon", appIcon, "-o", tauriIconsDir], {
    cwd: expoAppDir,
    stdio: "inherit",
  });

  // Tauri CLI は Android / iOS 用のアイコンも一緒に吐くが、モバイルは Expo 側で
  // 生成する（Tauri はデスクトップのみ）ため、不要な出力を消しておく。
  for (const mobileDir of ["android", "ios"]) {
    await rm(join(tauriIconsDir, mobileDir), { recursive: true, force: true });
  }

  // macOS の .icns だけは、角丸と余白を描き込んだ画像から作り直す。
  // 一時ディレクトリで Tauri CLI をもう一度走らせ、できた icon.icns だけを持ってくる
  // （.icns の書き出しは Tauri CLI に任せ、自前で組み立てない）。
  const macosWorkDir = await mkdtemp(join(tmpdir(), "recipi-macos-icon-"));
  try {
    const macosSource = join(macosWorkDir, "macos-icon.png");
    await writeFile(macosSource, await buildMacosIcon(appIcon));
    execFileSync(process.execPath, [tauriCli, "icon", macosSource, "-o", macosWorkDir], {
      cwd: expoAppDir,
      stdio: "inherit",
    });
    await copyFile(join(macosWorkDir, "icon.icns"), join(tauriIconsDir, "icon.icns"));
  } finally {
    // 後始末は失敗してもメインの処理結果を変えない
    await rm(macosWorkDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`✔ デスクトップ用アイコンを生成しました: ${relative(repoRoot, tauriIconsDir)}`);
  console.log("\n生成された差分を git diff で確認してからコミットしてください。");
}

await main();
