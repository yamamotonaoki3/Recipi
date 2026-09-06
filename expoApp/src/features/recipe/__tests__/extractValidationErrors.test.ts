/**
 * サーバー 400 の details.errors 抽出（作成/編集画面のフィールド別エラー表示に使う）。
 */
import { ApiError } from "@/features/auth/api";
import { extractValidationErrors } from "../api";

describe("extractValidationErrors", () => {
  it("Pydantic 形式のエラー配列を取り出す", () => {
    const err = new ApiError("不正です", "VALIDATION_ERROR", 400, {
      errors: [
        { loc: ["body", "title"], msg: "too long", type: "string_too_long" },
        { loc: ["body", "servings"], msg: "out of range", type: "value_error" },
      ],
    });
    const out = extractValidationErrors(err);
    expect(out).toHaveLength(2);
    expect(out[0].loc).toEqual(["body", "title"]);
  });

  it("details が無い / 形が違うなら空配列", () => {
    expect(extractValidationErrors(new ApiError("x", "X", 400, null))).toEqual([]);
    expect(extractValidationErrors(new ApiError("x", "X", 400, { errors: "nope" }))).toEqual([]);
    expect(
      extractValidationErrors(new ApiError("x", "X", 400, { errors: [{ msg: "no loc" }] })),
    ).toEqual([]);
  });
});
