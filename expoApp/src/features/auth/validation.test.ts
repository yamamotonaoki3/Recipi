/**
 * validation.ts の単体テスト（BB: 境界値・同値分割）。
 */
import {
  hasFieldErrors,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordMatch,
  validatePasswordResetConfirm,
  validateSecurityAnswer,
  validateSecurityQuestion,
  validateSignup,
} from "./validation";

describe("validateEmail", () => {
  it("空文字はエラー", () => {
    expect(validateEmail("")).toBeDefined();
  });
  it("@ を含まない文字列はエラー", () => {
    expect(validateEmail("not-an-email")).toBeDefined();
  });
  it("正しい形式は undefined", () => {
    expect(validateEmail("testuser_001@example.com")).toBeUndefined();
  });
});

describe("validatePassword（境界値: 7/8/72/73文字）", () => {
  it("7文字はエラー", () => {
    expect(validatePassword("a".repeat(7))).toBeDefined();
  });
  it("8文字はOK", () => {
    expect(validatePassword("a".repeat(8))).toBeUndefined();
  });
  it("72文字はOK", () => {
    expect(validatePassword("a".repeat(72))).toBeUndefined();
  });
  it("73文字はエラー", () => {
    expect(validatePassword("a".repeat(73))).toBeDefined();
  });
});

describe("validatePasswordMatch", () => {
  it("一致すれば undefined", () => {
    expect(validatePasswordMatch("TestPass123!", "TestPass123!")).toBeUndefined();
  });
  it("不一致はエラー", () => {
    expect(validatePasswordMatch("TestPass123!", "Different1!")).toBeDefined();
  });
  it("確認欄が空でもエラー", () => {
    expect(validatePasswordMatch("TestPass123!", "")).toBeDefined();
  });
});

describe("validateDisplayName（境界値: 0/1/30/31文字）", () => {
  it("空文字はエラー", () => {
    expect(validateDisplayName("")).toBeDefined();
  });
  it("1文字はOK", () => {
    expect(validateDisplayName("A")).toBeUndefined();
  });
  it("30文字はOK", () => {
    expect(validateDisplayName("あ".repeat(30))).toBeUndefined();
  });
  it("31文字はエラー", () => {
    expect(validateDisplayName("あ".repeat(31))).toBeDefined();
  });
});

describe("validateSecurityQuestion / validateSecurityAnswer", () => {
  it("空文字はエラー", () => {
    expect(validateSecurityQuestion("")).toBeDefined();
    expect(validateSecurityAnswer("")).toBeDefined();
  });
  it("上限文字数以内はOK", () => {
    expect(validateSecurityQuestion("あ".repeat(120))).toBeUndefined();
    expect(validateSecurityAnswer("あ".repeat(100))).toBeUndefined();
  });
  it("上限超過はエラー", () => {
    expect(validateSecurityQuestion("あ".repeat(121))).toBeDefined();
    expect(validateSecurityAnswer("あ".repeat(101))).toBeDefined();
  });
});

describe("validateSignup", () => {
  const validValues = {
    email: "testuser_001@example.com",
    password: "TestPass123!",
    passwordConfirm: "TestPass123!",
    displayName: "テスト太郎",
    securityQuestion: "好きな食べ物は？",
    securityAnswer: "ラーメン",
  };

  it("すべて正しければエラー無し", () => {
    expect(hasFieldErrors(validateSignup(validValues))).toBe(false);
  });

  it("パスワード不一致で passwordConfirm にエラー", () => {
    const errors = validateSignup({ ...validValues, passwordConfirm: "Different1!" });
    expect(errors.passwordConfirm).toBeDefined();
  });

  it("パスワード自体が不正なときは passwordConfirm の不一致エラーを重ねて出さない", () => {
    // password が短すぎる場合、passwordConfirm も一致しないが、
    // 表示が二重にならないよう password 側のエラーだけを出す。
    const errors = validateSignup({
      ...validValues,
      password: "short",
      passwordConfirm: "short",
    });
    expect(errors.password).toBeDefined();
    expect(errors.passwordConfirm).toBeUndefined();
  });
});

describe("validatePasswordResetConfirm", () => {
  const validValues = {
    securityAnswer: "ラーメン",
    newPassword: "NewTestPass456!",
    newPasswordConfirm: "NewTestPass456!",
  };

  it("すべて正しければエラー無し", () => {
    expect(hasFieldErrors(validatePasswordResetConfirm(validValues))).toBe(false);
  });

  it("新パスワード不一致でエラー", () => {
    const errors = validatePasswordResetConfirm({
      ...validValues,
      newPasswordConfirm: "Different1!",
    });
    expect(errors.newPasswordConfirm).toBeDefined();
  });
});

describe("hasFieldErrors", () => {
  it("全部 undefined なら false", () => {
    expect(hasFieldErrors({ a: undefined, b: undefined })).toBe(false);
  });
  it("1つでも値があれば true", () => {
    expect(hasFieldErrors({ a: undefined, b: "エラー" })).toBe(true);
  });
});
