/**
 * Tauri デスクトップ（Windows/macOS）でのセキュアストレージ実装。
 *
 * `tauri-plugin-stronghold`（公式プラグイン。IOTA Stronghold の暗号化
 * Vault にシークレットを保存する）を使う。Vault は Rust 側の
 * `src-tauri/src/lib.rs` で登録した argon2 ハッシュ関数によって、
 * ここで渡す `VAULT_KEY` から実際の暗号鍵を導出する（公式 README の
 * 推奨実装パターン。ソルトは Rust 側に埋め込み）。
 *
 * 既知の制約（暫定仕様・todo）: `VAULT_KEY` はアプリのバンドルに含まれる
 * 固定文字列であり、OS のクレデンシャルストア（Windows Credential Manager /
 * macOS Keychain）のようにユーザーごとの秘密鍵で保護されているわけではない。
 * 実際の保護は「Vault ファイルが暗号化されている」ことと「導出用のソルト /
 * argon2 パラメータがアプリのソースにしか無い」ことに依存する。将来的に
 * OS クレデンシャルストアと連携する形に強化する余地がある（todo #28）。
 */
import { appDataDir } from "@tauri-apps/api/path";
import { Client, Stronghold } from "@tauri-apps/plugin-stronghold";

import type { SecureStorage } from "./types";

const VAULT_FILE_NAME = "recipi-vault.hold";
const CLIENT_NAME = "recipi-secure-storage";
const STORE_KEY = "refreshToken";
const USER_STORE_KEY = "user";
// Rust 側の argon2 ハッシュ関数への入力。実際の暗号強度はソルト＋argon2
// パラメータ（src-tauri/src/lib.rs）に依存するため、この文字列自体は
// 秘匿情報として扱わなくてよい（公式ドキュメントの実装例に準拠）。
const VAULT_KEY = "recipi-desktop-refresh-token-vault";

let clientPromise: Promise<{ stronghold: Stronghold; client: Client }> | null = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const vaultPath = `${await appDataDir()}/${VAULT_FILE_NAME}`;
      const stronghold = await Stronghold.load(vaultPath, VAULT_KEY);
      let client: Client;
      try {
        client = await stronghold.loadClient(CLIENT_NAME);
      } catch {
        client = await stronghold.createClient(CLIENT_NAME);
      }
      return { stronghold, client };
    })();
  }
  return clientPromise;
}

export const tauriSecureStorage: SecureStorage = {
  async getRefreshToken() {
    const { client } = await getClient();
    const store = client.getStore();
    const data = await store.get(STORE_KEY);
    if (!data) return null;
    return new TextDecoder().decode(new Uint8Array(data));
  },

  async setRefreshToken(token: string) {
    const { stronghold, client } = await getClient();
    const store = client.getStore();
    const bytes = Array.from(new TextEncoder().encode(token));
    await store.insert(STORE_KEY, bytes);
    await stronghold.save();
  },

  async deleteRefreshToken() {
    const { stronghold, client } = await getClient();
    const store = client.getStore();
    await store.remove(STORE_KEY);
    await stronghold.save();
  },

  async getUser() {
    const { client } = await getClient();
    const store = client.getStore();
    const data = await store.get(USER_STORE_KEY);
    if (!data) return null;
    return new TextDecoder().decode(new Uint8Array(data));
  },

  async setUser(userJson: string) {
    const { stronghold, client } = await getClient();
    const store = client.getStore();
    const bytes = Array.from(new TextEncoder().encode(userJson));
    await store.insert(USER_STORE_KEY, bytes);
    await stronghold.save();
  },

  async deleteUser() {
    const { stronghold, client } = await getClient();
    const store = client.getStore();
    await store.remove(USER_STORE_KEY);
    await stronghold.save();
  },
};
