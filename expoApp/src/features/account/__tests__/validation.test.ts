/**
 * アカウント設定の入力チェック（Issue #242）。
 *
 * BB: 文字数の境界（質問 120 / 答え 100 / 現パスワード 72）、空・空白だけ、確認の不一致。
 * WB: 文字数は `.length` ではなくコードポイントで数える（絵文字 1 つを 1 文字と数える。
 * サーバーと同じ。ずれると境界で「画面では通るのにサーバーで 400」になる）。
 */
import { validateSecurityQuestionForm, type SecurityQuestionFormValues } from "../validation";

const OK: SecurityQuestionFormValues = {
  currentPassword: "TestPass123!",
  securityQuestion: "初めて飼ったペットの名前は？",
  securityAnswer: "ポチ",
  securityAnswerConfirm: "ポチ",
};

function errorsOf(overrides: Partial<SecurityQuestionFormValues>) {
  return validateSecurityQuestionForm({ ...OK, ...overrides });
}

it("正しい入力ではエラーが無い", () => {
  expect(errorsOf({})).toEqual({});
});

describe("現在のパスワード", () => {
  it("空は画面で止める", () => {
    expect(errorsOf({ currentPassword: "" }).currentPassword).toBeDefined();
  });

  it("短くても止めない（サーバーは現パスワードに最小長を設けていない。照合に渡すだけ）", () => {
    expect(errorsOf({ currentPassword: "a" }).currentPassword).toBeUndefined();
  });

  it("72 文字までは通し、73 文字で止める", () => {
    expect(errorsOf({ currentPassword: "a".repeat(72) }).currentPassword).toBeUndefined();
    expect(errorsOf({ currentPassword: "a".repeat(73) }).currentPassword).toBeDefined();
  });
});

describe("新しい質問", () => {
  it("空・空白だけは止める", () => {
    expect(errorsOf({ securityQuestion: "" }).securityQuestion).toBeDefined();
    expect(errorsOf({ securityQuestion: "   " }).securityQuestion).toBeDefined();
  });

  it("120 文字までは通し、121 文字で止める", () => {
    expect(errorsOf({ securityQuestion: "あ".repeat(120) }).securityQuestion).toBeUndefined();
    expect(errorsOf({ securityQuestion: "あ".repeat(121) }).securityQuestion).toBeDefined();
  });

  it("絵文字は 1 文字と数える（120 個なら通る）", () => {
    expect(errorsOf({ securityQuestion: "🍜".repeat(120) }).securityQuestion).toBeUndefined();
  });
});

describe("新しい答え", () => {
  it("空・空白だけは止める", () => {
    expect(
      errorsOf({ securityAnswer: "", securityAnswerConfirm: "" }).securityAnswer,
    ).toBeDefined();
    expect(
      errorsOf({ securityAnswer: "  ", securityAnswerConfirm: "  " }).securityAnswer,
    ).toBeDefined();
  });

  it("100 文字までは通し、101 文字で止める", () => {
    const a100 = "あ".repeat(100);
    const a101 = "あ".repeat(101);
    expect(
      errorsOf({ securityAnswer: a100, securityAnswerConfirm: a100 }).securityAnswer,
    ).toBeUndefined();
    expect(
      errorsOf({ securityAnswer: a101, securityAnswerConfirm: a101 }).securityAnswer,
    ).toBeDefined();
  });

  it("絵文字は 1 文字と数える（100 個なら通る）", () => {
    const e100 = "🍜".repeat(100);
    expect(
      errorsOf({ securityAnswer: e100, securityAnswerConfirm: e100 }).securityAnswer,
    ).toBeUndefined();
  });
});

describe("確認用の答え", () => {
  it("一致しなければ止める", () => {
    expect(errorsOf({ securityAnswerConfirm: "タマ" }).securityAnswerConfirm).toBe(
      "答えが一致しません",
    );
  });

  it("空白の有無も不一致として扱う（打ち間違いを見逃さない）", () => {
    expect(errorsOf({ securityAnswerConfirm: "ポチ " }).securityAnswerConfirm).toBeDefined();
  });
});
