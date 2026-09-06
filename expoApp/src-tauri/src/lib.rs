#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      // Issue #36: リフレッシュトークン（「ログインを保持」時）をデスクトップで
      // 安全に保存するための Stronghold プラグイン。JS 側から渡される
      // パスワード文字列（src/lib/secureStorage/secureStorage.tauri.ts の
      // VAULT_KEY）をここで argon2 ハッシュして、実際の Vault 暗号鍵にする
      // （tauri-plugin-stronghold 公式 README の推奨実装パターン）。
      //
      // ソルトを固定文字列にしているのは暫定仕様（todo #28）: 本来は
      // ビルドごとに変えるか、OS のクレデンシャルストアと組み合わせるのが
      // 望ましいが、Issue #36 の時点ではこの Vault は「リフレッシュトークン
      // 1 本を平文よりはるかに安全に保存する」という最低限の目的を満たせば
      // よいと判断し、シンプルな固定ソルト方式にしている。
      tauri_plugin_stronghold::Builder::new(|password| {
        use argon2::{hash_raw, Config, Variant, Version};

        let config = Config {
          lanes: 4,
          mem_cost: 10_000,
          time_cost: 10,
          variant: Variant::Argon2id,
          version: Version::Version13,
          ..Default::default()
        };

        // このソルト自体は秘匿情報ではない（Vault の安全性は「アプリの
        // ソースコードにしか無い」ことに依存するのではなく、Vault ファイル
        // 自体が暗号化されていることに依存する）。
        let salt = b"recipi-stronghold-salt-v1";

        hash_raw(password.as_ref(), salt, &config)
          .expect("failed to hash stronghold password")
          .to_vec()
      })
      .build(),
    )
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
