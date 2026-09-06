/**
 * 認証まわりのクライアント側バリデーション定数。
 *
 * バックエンド（backend/app/schemas/auth.py）が実際に強制している値と
 * 合わせてある。ただし docs/requirements/features/auth.md §8 に
 * 「仮でよい・todo #16」と明記されている暫定値なので、将来変わりうる。
 * クライアント側の目的は「早期フィードバック」であり、これらの数値と
 * バックエンドの実際のルールがズレても、API からの 400 エラーは
 * そのまま画面に表示できるようにする（クライアント側の値をハードコードで
 * 過信しない）。
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const DISPLAY_NAME_MAX_LENGTH = 30;
export const SECURITY_QUESTION_MAX_LENGTH = 120;
export const SECURITY_ANSWER_MAX_LENGTH = 100;
