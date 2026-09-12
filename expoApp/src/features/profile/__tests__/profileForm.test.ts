/**
 * プロフィールフォームの純粋関数と URL 検証のテスト（BB: 境界値 / WB: 分岐）。
 */
import type { UserSelfProfile } from "../api";
import {
  buildPatch,
  fromProfile,
  isDirty,
  mapServerErrors,
  validateProfileForm,
  type ProfileFormValues,
} from "../profileForm";
import { PROFILE_URL_MAX_LENGTH, validateProfileUrl } from "../validation";

const profile: UserSelfProfile = {
  id: "u1",
  displayName: "テスト太郎",
  email: "testuser_001@example.com",
  avatarUrl: null,
  followingCount: 0,
  followerCount: 0,
  isFollowing: null,
  emailPublic: false,
  xUrl: "https://x.com/testuser_001",
  xPublic: true,
  instagramUrl: null,
  instagramPublic: false,
  otherUrl: null,
  otherPublic: false,
};

const base: ProfileFormValues = fromProfile(profile);

describe("validateProfileUrl", () => {
  it.each([
    ["", undefined],
    ["   ", undefined],
    ["　", undefined],
    ["http://example.com", undefined],
    ["https://example.com/a?b=c", undefined],
    ["  https://example.com  ", undefined],
  ])("%p は OK", (value, expected) => {
    expect(validateProfileUrl(value)).toBe(expected);
  });

  it.each(["ftp://example.com", "example.com", "https://exa mple.com", "https://", "javascript:x"])(
    "%p は形式エラー",
    (value) => {
      expect(validateProfileUrl(value)).toMatch("http:// または https://");
    },
  );

  it("2048 文字ちょうどは OK、2049 文字はエラー", () => {
    const prefix = "https://example.com/";
    const ok = prefix + "a".repeat(PROFILE_URL_MAX_LENGTH - prefix.length);
    expect(Array.from(ok)).toHaveLength(2048);
    expect(validateProfileUrl(ok)).toBeUndefined();
    expect(validateProfileUrl(ok + "a")).toMatch("2048文字以内");
  });

  it("文字数はコードポイントで数える（絵文字 1 つ = 1 文字）", () => {
    const prefix = "https://example.com/";
    const ok = prefix + "😀".repeat(PROFILE_URL_MAX_LENGTH - prefix.length);
    expect(validateProfileUrl(ok)).toBeUndefined();
  });
});

describe("fromProfile", () => {
  it("null の URL は空文字にする", () => {
    expect(base.instagramUrl).toBe("");
    expect(base.xUrl).toBe("https://x.com/testuser_001");
  });
});

describe("validateProfileForm", () => {
  it("正しい値ならエラーなし", () => {
    expect(validateProfileForm(base)).toEqual({});
  });

  it("表示名 30 文字は OK、31 文字・空白だけはエラー", () => {
    expect(validateProfileForm({ ...base, displayName: "あ".repeat(30) })).toEqual({});
    expect(validateProfileForm({ ...base, displayName: "あ".repeat(31) }).displayName).toBe(
      "表示名は30文字以内で入力してください",
    );
    expect(validateProfileForm({ ...base, displayName: "　 " }).displayName).toBe(
      "表示名を入力してください",
    );
  });

  it("URL のエラーは欄ごとに返す", () => {
    const errors = validateProfileForm({ ...base, xUrl: "bad", otherUrl: "ftp://a" });
    expect(Object.keys(errors).sort()).toEqual(["otherUrl", "xUrl"]);
  });
});

describe("buildPatch / isDirty", () => {
  it("変更が無ければ空で、dirty ではない", () => {
    expect(buildPatch(base, base)).toEqual({});
    expect(isDirty(base, base)).toBe(false);
  });

  it("変わった項目だけを入れる", () => {
    const patch = buildPatch(base, {
      ...base,
      displayName: "新しい名前",
      emailPublic: true,
      instagramUrl: "https://instagram.com/testuser_001",
    });
    expect(patch).toEqual({
      displayName: "新しい名前",
      emailPublic: true,
      instagramUrl: "https://instagram.com/testuser_001",
    });
  });

  it("URL を空・空白だけにすると null（削除）を送る", () => {
    expect(buildPatch(base, { ...base, xUrl: "  " })).toEqual({ xUrl: null });
  });

  it("URL は前後の空白を落として送り、空白を足しただけなら変更なし", () => {
    expect(buildPatch(base, { ...base, xUrl: " https://x.com/testuser_001 " })).toEqual({});
    expect(buildPatch(base, { ...base, otherUrl: " https://example.com " })).toEqual({
      otherUrl: "https://example.com",
    });
  });

  it("トグルを戻すと dirty でなくなる", () => {
    const toggled = { ...base, xPublic: false };
    expect(isDirty(base, toggled)).toBe(true);
    expect(isDirty(base, { ...toggled, xPublic: true })).toBe(false);
  });
});

describe("mapServerErrors", () => {
  it("loc の欄名に割り当てる（同じ欄は最初の 1 件）", () => {
    expect(
      mapServerErrors({
        errors: [
          { loc: ["body", "xUrl"], msg: "URL が不正です" },
          { loc: ["body", "xUrl"], msg: "2 件目" },
          { loc: ["body", "displayName"], msg: 123 },
        ],
      }),
    ).toEqual({ xUrl: "URL が不正です", displayName: "入力内容を確認してください" });
  });

  it("知らない欄・形が違うものは無視する", () => {
    expect(mapServerErrors(null)).toEqual({});
    expect(mapServerErrors({ errors: "x" })).toEqual({});
    expect(mapServerErrors({ errors: [{ loc: "xUrl" }, { loc: ["body", "foo"] }] })).toEqual({});
  });
});
