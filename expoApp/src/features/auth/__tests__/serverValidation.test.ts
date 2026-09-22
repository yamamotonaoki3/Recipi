import { mapServerValidationErrors } from "../validation";

describe("mapServerValidationErrors", () => {
  it("details.errors をフォームの項目別メッセージへ変換する", () => {
    expect(
      mapServerValidationErrors(
        {
          errors: [
            { loc: ["body", "email"], msg: "Input should be a valid email address" },
            { loc: ["body", "password"], msg: "String should have at least 8 characters" },
          ],
        },
        ["email", "password"],
      ),
    ).toEqual({
      email: "有効なメールアドレスを入力してください",
      password: "パスワードの長さを確認してください",
    });
  });

  it("未知の項目や不正な details はフォーム全体のエラーにする", () => {
    expect(
      mapServerValidationErrors({ errors: [{ loc: ["body", "unknown"], msg: "bad" }] }, ["email"]),
    ).toEqual({
      form: "入力内容を確認してください",
    });
    expect(mapServerValidationErrors(null, ["email"])).toEqual({
      form: "入力内容を確認してください",
    });
  });

  it("snake_case のlocもcamelCaseの欄へ割り当てる", () => {
    expect(
      mapServerValidationErrors(
        {
          errors: [
            {
              loc: ["body", "security_question"],
              msg: "String should have at most 120 characters",
            },
          ],
        },
        ["securityQuestion"],
      ),
    ).toEqual({ securityQuestion: "秘密の質問の文字数を確認してください" });
  });
});
