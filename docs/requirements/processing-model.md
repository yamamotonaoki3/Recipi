# 処理方式（トランザクション / 同期 / 非同期 / バッチ）

> **この文書が「正」**: どの処理を 1 つの DB トランザクションにまとめるか、どれを HTTP レスポンスの前にやり切るか（同期）、どれをレスポンス後に回すか（非同期後処理）、どれを定期実行にするか（バッチ）を、機能横断でここに定義する。各 `features/*.md` と [non-functional.md](non-functional.md) はこの文書を参照する。
>
> ねらいは [non-functional.md](non-functional.md) の非機能要件（レスポンス 300ms 目安・カウントの整合性・濫用対策）を、機能ごとにバラバラの設計をせずに満たすこと。

## 1. この文書の読み方

- **はじめて出てくる用語・技術**は §2 で「ひとことで言うと / なぜ Recipi で使うか / 使わないと何が困るか / 代替案」の形で説明する。ここまでの設計で既出のもの（カーソルページング等）は [glossary.md](glossary.md) 参照。
- **どの方式を選んだかとその理由**は §3 にサマリ表がある。§6〜§8 の各項目にも理由を添える。
- 「同期 / 非同期 / バッチ」に唯一の正解は無く、**前提（利用者数・許容遅延・障害時にどうなるか）次第で変わる**。だから判断ごとに理由を残す。

## 2. はじめて出てくる用語・技術（初心者向け）

このプロジェクトのこれまでの会話に出ていない用語を説明する。

### トランザクション

**ひとことで言うと**: 複数の書き込みを「全部成功」か「全部なかったことにする（ロールバック）」のどちらかにまとめる仕組み。

**なぜ使うか**: 例えば「お気に入り登録」は ①`favorites` テーブルに 1 行足す ②`recipes.favorite_count` を +1 する、の 2 つの書き込みからなる。①だけ成功して②が失敗すると、一覧に出るのに数字は増えていない、という食い違いが残る。2 つを 1 トランザクションにすれば「両方成功」か「両方なし」になる。

**使わないと**: 途中で失敗したりサーバーが落ちたとき、中途半端なデータが残る。

### 行ロック（`SELECT ... FOR UPDATE`）

**ひとことで言うと**: 「今からこの行を更新するので、ほかの人は順番待ちしてください」と DB に予約すること。

**なぜ使うか**: 同じレシピに 2 人が同時にお気に入りを付けると、両方が「今 5 件」を読んで「6 件に更新」してしまい、本当は 7 件なのに 6 件になる（更新の取りこぼし）。先に対象行をロックして順番に処理させれば正しく 7 件になる。
複数の行をロックするときは、全員が**同じ順番（id の昇順）**でロックする。順番がバラバラだと、A が行1→行2、B が行2→行1 を待ち合って両方止まる「デッドロック」が起きる。

**代替案**: `favorite_count` を毎回 `COUNT(*)` で数え直す方式ならロック不要だが、レシピ一覧のたびに集計クエリが走って遅くなる（[non-functional.md](non-functional.md) がカウント列キャッシュを採用している理由）。

### `INSERT ... ON CONFLICT DO NOTHING`（upsert の一種）

**ひとことで言うと**: 「すでに同じ行があれば、エラーにせず黙って何もしない」挿入。

**なぜ使うか**: フォローやお気に入りを二重に押しても行が 2 つできないようにする。さらに「**実際に 1 行増えたときだけ**カウントを +1」という判定ができる（冪等なフォロー操作。[follow.md](features/follow.md) / [favorite.md](features/favorite.md)）。

### 冪等（べきとう / idempotent）

**ひとことで言うと**: 同じ操作を 2 回以上実行しても、結果が 1 回のときと変わらない性質。

**なぜ使うか**: モバイルは通信が不安定で、クライアントが「送れたか分からず」もう一度同じリクエストを送ることがある。冪等ならそれで壊れない。フォロー / お気に入り / 閲覧記録はこの性質を持たせる。

### `BackgroundTasks`（FastAPI の機能）

**ひとことで言うと**: HTTP レスポンスを返した**後**に、同じサーバープロセスで「ついでに」実行する処理の仕組み。FastAPI に最初から付いている。

**なぜ使うか**: レシピ投稿の「201 作成成功」をすぐ返し、フォロワーへの通知作成のような時間のかかる後始末は裏で実行して、投稿者を待たせない。追加のサーバーソフトが要らない。

**弱点**: サーバーのプロセスが落ちると、実行中・未実行の裏処理は消える（再開しない）。だから**失われても整合性を壊さない処理だけ**に使い、大事な整合は §3 のとおりトランザクションか定期バッチで守る。

**代替案**: 専用のジョブキュー（下記）。再試行や失敗の可視化が要る規模になったら移行する。

### fan-out（ファンアウト）

**ひとことで言うと**: 1 つの出来事を、関係する大勢に配ること。

**なぜ関係するか**: 「公開レシピを 1 件投稿」で「フォロワー全員に通知行を作る」のが fan-out。フォロワーが多いと `notifications` への INSERT が数千行になり得るので、リクエストの中でやると投稿者が待たされる。だから非同期にする（§3・§7）。

### cron（クロン）/ コンテナスケジューラ

**ひとことで言うと**: 決めた時刻・間隔でコマンドを自動実行する、OS やインフラの標準機能。

**なぜ使うか**: 「毎日 4 時にカウントの数え直しコマンドを実行」のような定期処理を回す。アプリ本体（`api`）とは別プロセスとして起動するので、アプリの再起動やホットリロードに巻き込まれない。

**代替案**: APScheduler（下記）。

### APScheduler

**ひとことで言うと**: アプリのプロセスの中で「◯分ごとに関数を呼ぶ」を実現する Python ライブラリ。

**なぜ採用しないか**: アプリを複数プロセス（ワーカー）で動かすと、同じジョブが同時に何回も走ってしまう。それを防ぐ仕組み（ロック）を自前で足す必要がある。cron 方式ならスケジューラ側で 1 本に絞れるので、今回は cron を採用（§3）。

### ジョブキュー（arq / Celery + Redis）

**ひとことで言うと**: 「やること」を一覧（キュー）に積み、専用のワーカープロセスが順に取り出して実行する仕組み。Redis というインメモリのデータストアを間に置くことが多い。

**得意なこと**: 失敗したジョブの自動再試行、実行予約、どのジョブが失敗したかの可視化。

**代わりに増えるもの**: Redis というミドルウェアの運用、ワーカープロセスの常駐、全体の複雑さ。

**なぜ今は使わないか**: MVP の規模（フォロワー数百〜数千）では `BackgroundTasks` で足りる見込みで、Redis を足すコストのほうが大きい。大量フォロワーの性能測定や再試行要件が出てきたら Phase 10 以降に導入を検討する（§3・[todo.md](todo.md) #18）。

### 多層防御

**ひとことで言うと**: 1 つの対策が漏れても次の対策で拾えるように、守りを重ねること。

**例**: カウント列はまずトランザクション内で正しく増減する（第 1 層）。それでもバグや異常終了でズレたら、定期バッチが実数から数え直して直す（第 2 層）。

### 削除キュー（`pending_storage_deletions` テーブル）

**ひとことで言うと**: 「あとで消す画像のオブジェクトキー」を書きためておく ToDo リスト。

**なぜ使うか**: レシピ削除のときに画像ストレージ（S3 / MinIO）へ直接「消して」と言いに行くと、ストレージが一時的に落ちていたらレシピ削除まで失敗してしまう。まずキューに「このキーを消す」と書いておき（速い・確実）、専用の定期バッチが後でまとめて実際に消す。

## 3. 設計判断と理由（サマリ）

| 判断 | 採用 | 理由 |
| --- | --- | --- |
| リクエストとトランザクション | **1 リクエスト = 1 DB トランザクション** | 複数テーブル書き込みの中途半端な適用を防ぐ。レビュー時に「この API はどこまで一括で成功/失敗するか」が一目で分かる。カウント列と関連行の食い違いを構造的に防ぐ |
| 外部 I/O（ストレージ・AI）の位置 | **トランザクションの外** | ストレージや AI プロバイダの障害・遅延で DB 更新をロールバックさせない。トランザクション中に外部の応答を待つとロック保持が延び、300ms 目安（[non-functional.md](non-functional.md)）を壊す |
| 即時の後処理の実行基盤（MVP） | FastAPI **`BackgroundTasks`**（プロセス内・ブローカー無し） | 追加インフラ（Redis / ワーカー）が要らず Phase 0 の scaffold が軽い。「従来方式を先に学ぶ」方針（[../../CLAUDE.md](../../CLAUDE.md) 学習方針・[todo.md](todo.md) #39）に沿う。本番デプロイ先が未定（[todo.md](todo.md) #2）でも動く。MVP 規模なら「まれな取りこぼし」のコスト < 「キュー基盤の運用の複雑さ」 |
| 定期処理の実行基盤（MVP） | 管理用 CLI コマンドを **cron / コンテナスケジューラ**で起動 | 状態を持たない単発プロセス。スケジューラはインフラの標準機能で多重起動を 1 本に絞れる。アプリ本体に常駐スレッドを持たせないのでリロード・多重ワーカーの影響を受けない |
| 専用ジョブキュー（arq / Celery + Redis） | **Phase 10 以降に再検討** | 大量フォロワーの fan-out 性能測定（[todo.md](todo.md) #18）や自動再試行の要件が出てから入れる。先に入れると学習・運用コストが機能価値より先行する |
| 通知 fan-out（`followee_new_recipe`） | 最初から**非同期**（Tx コミット後に `BackgroundTasks`） | フォロワー数だけ `notifications` に INSERT するため最悪数千行。リクエスト内だと投稿者を待たせ 300ms 目安を破る。通知はベストエフォートで、多少取りこぼしても投稿自体の価値は損なわれない |
| 単一行の通知（`followed` / `recipe_favorited` / `recipe_commented`） | 発火元と**同一トランザクション**で同期 INSERT | 1 行 INSERT で軽く、fan-out と違って相手が増えてもスケールする。「お気に入り成立」と「通知」が食い違わない一括性が得られる |
| カウント列の整合 | 増減を関連行と同一トランザクション ＋ **補正バッチ（多層防御）** | 第一の正はトランザクション内の原子的増減（[non-functional.md](non-functional.md)）。バグ・異常終了・レースの残りに備え、実数から数え直す定期バッチを保険に置く |
| ストレージ削除 | **削除キューへの登録は発火元と同一トランザクション**、S3 / MinIO への**実 DELETE は定期バッチ** | キュー登録は DB への INSERT だけなので同一 Tx に入れられ、コミットすれば消し忘れが起きない。ストレージ障害を削除 API に波及させたくないので、実 DELETE だけを後回しにする |
| クライアントの楽観的更新 | ♡ / フォローの**ボタンとその数だけ**は楽観更新（即時 ±1・失敗時ロールバック）。**一覧の中身（フィードの並び・件数・他画面のカウント）は再取得まで更新しない** | ボタンの即時反応は UX 上必要（[screens/recipe-detail.md](screens/recipe-detail.md) / [screens/connections.md](screens/connections.md)）。一方でフィード全体を毎回貼り替えるとスクロール位置が飛ぶ。サーバーのカウント列が正で、次回取得時に突き合わせる（[home-feed.md](features/home-feed.md)） |
| 閲覧記録の呼び出し | クライアントが**詳細取得成功後に fire-and-forget** | `GET /recipes/{id}` に副作用を持たせない（再描画やプリフェッチで多重記録しない）。記録の失敗が閲覧体験を妨げない（[view-history.md](features/view-history.md) / [lessons-learned.md](../lessons-learned.md)） |

## 4. 用語（この文書内の呼び方）

| 用語 | 定義 |
| --- | --- |
| 同期処理 | HTTP リクエストの内側で実行し、結果をレスポンスに含める。利用者はこの完了を待つ |
| 非同期後処理 | レスポンスを返した**後**にプロセス内 `BackgroundTasks` で実行する副作用。失敗してもレスポンスは成功のまま。ベストエフォート |
| 定期バッチ | cron / コンテナスケジューラが管理用 CLI コマンドを定期起動して実行する処理。掃除・数え直し・多層防御に使う |
| トランザクション境界 | 1 つの DB トランザクション（`BEGIN` 〜 `COMMIT`）にまとめる書き込みの範囲 |
| 削除エンキュー | 参照から外れたオブジェクトキーを削除キュー（§9）に書き込む操作。実削除は定期バッチが行う |

## 5. 全体方針

各項目の背景は §3。

1. **1 リクエスト = 1 DB トランザクション**を原則とする。1 回の API 呼び出しで複数テーブルを書くときは同一トランザクション（レシピ CRUD、カウント列の増減、アカウント削除、トークンローテーション）。
2. **外部サービスへの呼び出し（S3 / MinIO への PUT / DELETE・AI プロバイダ・将来のメール等）をトランザクション内に入れない。** ストレージの実 DELETE・fan-out・AI 呼び出しはトランザクション外。**ただし DB だけで完結する処理（削除キューへの行 INSERT、通知行の INSERT）はトランザクション内に入れる** — 外部待ちが無く軽いうえ、コミットと運命を共にできるので取りこぼしが起きない。
3. **トランザクションは短く。** ロック保持時間を最小化する（カウント列は対象行だけを `FOR UPDATE`。[non-functional.md](non-functional.md)）。
4. **`BackgroundTasks` は「失われても整合性を壊さないもの」限定。** 壊れると困る整合は「同期でトランザクション内」か「定期バッチの多層防御」で守る。
5. `deadlock` / `serialization_failure` はサーバー側でトランザクションを数回リトライ（[non-functional.md](non-functional.md)。上限は → [todo.md](todo.md) #10）。クライアントには見せない。
6. **楽観的更新は ♡ / フォローのボタンとその数に限る**（即時 ±1・失敗時ロールバック。[screens/recipe-detail.md](screens/recipe-detail.md)）。フィードの並び・件数や他画面のカウントは再取得まで更新しない（[home-feed.md](features/home-feed.md)）。サーバーのカウント列が正。
7. **通知の作成は、単一行なら発火元と同一トランザクション、fan-out（N 行）なら非同期後処理。**

## 6. 機能別の処理構成

トランザクション境界・同期/非同期・関連バッチの一覧。詳細は各 `features/*.md`。

| 機能 | 操作 | トランザクション境界 | 同期 / 非同期 | 関連バッチ |
| --- | --- | --- | --- | --- |
| 認証 | signup | `users` INSERT ＋ 初回 `refresh_tokens` INSERT を 1 Tx | 同期 | 期限切れトークン掃除 |
| 認証 | login | `refresh_tokens` INSERT（`rememberMe` で有効期限を調整）を 1 Tx | 同期 | 〃 |
| 認証 | refresh | 旧トークンに `revoked_at` セット ＋ 新トークン INSERT を 1 Tx。リユース検知時は同一 Tx で `chain_id` 全体を失効（[auth.md](features/auth.md)） | 同期 | 〃 |
| 認証 | logout | 対象チェーンの `refresh_tokens` を失効 | 同期 | 〃 |
| 認証 | password-reset/confirm | `password_hash` 更新 ＋ `users.token_version` +1 ＋ 当該ユーザーの全 `refresh_tokens` 失効 を 1 Tx（[auth.md](features/auth.md)） | 同期 | — |
| プロフィール | PATCH /users/me | `users` UPDATE のみ | 同期 | — |
| プロフィール | アバター PUT | `POST /images` と同じ段階方式: ①新キーの管理行を `pending` で INSERT → ②オブジェクトを PUT → ③**1 Tx**で `users.avatar_key` を新キーに更新 ＋ 旧キーを削除キューに登録 ＋ 新キーの管理行を消費済みに。②③失敗時は新キー行が未参照のまま残り GC が回収（§9） | 同期（②の PUT と③の削除キュー登録を含む） | ストレージ削除ジョブ・一時アップロード GC |
| プロフィール | アバター DELETE | **1 Tx**: `users.avatar_key` を NULL に ＋ 旧キーを削除キューに登録 | 同期（削除キュー登録を含む） | ストレージ削除ジョブ |
| プロフィール | アカウント削除（DELETE /users/me） | **単一 Tx**: `token_version` +1 → **CASCADE 削除の前に、消えるレシピ / 手順 / 感想 / アバターの画像キー ＋ 本人所有で未消費の `uploads`（`pending` / `stored`）のキーを全て集めて削除キューに INSERT** → CASCADE 削除 → 生き残る他ユーザー / 他レシピのカウント列を減算 or ピンポイントに数え直し → COMMIT（[non-functional.md](non-functional.md) / [profile.md](features/profile.md) / [data-model.md](data-model.md)） | 同期 | カウント補正ジョブ（多層防御）・ストレージ削除ジョブ（画像） |
| レシピ | POST / PUT | **1 Tx**: `recipes` ＋ `ingredient_groups` ＋ `ingredients`（全入れ替え）＋ `steps`（全入れ替え）＋ `units` 未登録分の `ON CONFLICT` upsert ＋ `title_normalized` / `name_normalized` 生成。PUT で参照から外れた画像キーは同一 Tx で削除キューに登録 | 同期（削除キュー登録を含む） | ストレージ削除ジョブ・一時アップロード GC |
| レシピ | 公開レシピの新規投稿（副作用） | 上記 Tx 内で `notification_outbox` に 1 行 → コミット後に `BackgroundTasks` が fan-out。取りこぼしは定期スイープが回収（§7・§8・§9） | **非同期**（`BackgroundTasks` ＋ outbox） | 通知 outbox スイープ・古い通知の掃除 |
| レシピ | DELETE | **1 Tx**: サムネ・手順画像・そのレシピへの感想画像のキーを**集めて削除キューに INSERT** → CASCADE（材料 / グループ / 手順 / お気に入り / 感想 / 通知）＋ 自分の他レシピ材料の `ref_recipe_id` を SET NULL | 同期（削除キュー登録を含む） | ストレージ削除ジョブ |
| 単位 | GET /units | 読み取りのみ | 同期 | 未使用単位の掃除（将来） |
| 画像 | POST /images | **順序**: ①`pending`（`expires_at` 付き）行を INSERT してキーを確定 → ②オブジェクトを S3 / MinIO に PUT → ③行をロックしてまだ `pending` なら `stored` に更新し `{key, url}` を返す。②失敗は行が `pending` で残り GC が回収。③で行が消えて / 期限切れなら②のオブジェクトを削除キューに積んで 5xx（§9） | 同期（②のストレージ PUT を含む。DB トランザクションは①と③に分ける） | 一時アップロード GC |
| ホーム / 検索 | GET /recipes | 読み取りのみ。`isFollowing` / `isFavorited` / 各カウントはまとめて取得（N+1 回避。[non-functional.md](non-functional.md)） | 同期 | — |
| 閲覧履歴 | POST /recipes/{id}/view | `recipe_views` の upsert を 1 Tx | サーバーは同期・**クライアントは詳細取得成功後に fire-and-forget** | 保持件数トリミング（→ [todo.md](todo.md) #9d） |
| 閲覧履歴 | GET / DELETE /users/me/history | 読み取り / 全削除 | 同期 | — |
| フォロー | POST / DELETE follow | **1 Tx**: `follows` INSERT（`ON CONFLICT DO NOTHING`）/ DELETE（削除件数チェック）＋ 実際に増減したときだけ関与 2 行を id 昇順で `FOR UPDATE` → `following_count` / `follower_count` 更新。成立時は `followed` 通知を同一 Tx で INSERT（[follow.md](features/follow.md)） | 同期 | カウント補正ジョブ |
| お気に入り | POST / DELETE favorite | **1 Tx**: `favorites` INSERT / DELETE ＋ `recipes.favorite_count` 増減。成立かつ他人のレシピなら `recipe_favorited` 通知を同一 Tx で INSERT（[favorite.md](features/favorite.md)） | 同期 | カウント補正ジョブ |
| 感想 | POST / DELETE comment | **1 Tx**: `recipe_comments` INSERT / DELETE ＋ `recipes.comment_count` 増減。新規投稿時は `recipe_commented` 通知を同一 Tx で INSERT。削除で外れた画像キーは同一 Tx で削除キューに登録（[comment.md](features/comment.md)） | 同期（削除キュー登録を含む） | ストレージ削除ジョブ |
| 感想 | PATCH comment | `recipe_comments` UPDATE のみ（カウント不変・通知なし）。差し替え / 削除で外れた旧画像キーは同一 Tx で削除キューに登録 | 同期（削除キュー登録を含む） | ストレージ削除ジョブ |
| 通知 | GET /notifications, GET /notifications/unread-count | 読み取りのみ（`unreadCount` も同時に返す。[non-functional.md](non-functional.md)） | 同期 | 古い通知の掃除（→ [todo.md](todo.md) #18） |
| 通知 | POST /notifications/read | `notifications.read_at` の一括 UPDATE | 同期 | — |
| AI 校正（Phase 11） | POST /ai/proofread | DB 書き込みは無し（レート制限カウンタのみ）。プロバイダ呼び出しはタイムアウト付き・トランザクション外 | リクエストスコープ（**外部 I/O は Tx 外**）。クライアント UI は非同期（[ai-proofread.md](features/ai-proofread.md)） | `ai_usage` の集計 / 日次リセット（→ [todo.md](todo.md) #45） |

> **通知の生成タイミング**: 上表の「成立時に `followed` / `recipe_favorited` / `recipe_commented` を同一 Tx で INSERT」は **Phase 8（通知）で発火元の書き込み経路に組み込む**。Phase 5〜7 の時点では `notifications` テーブルが無く通知行は作らない（[roadmap.md](roadmap.md)）。`followee_new_recipe` の fan-out も Phase 8。

## 7. 非同期後処理（`BackgroundTasks`）の台帳

> ここに載るのは「レスポンスを返した後に走り、結果をレスポンスに含められない」処理だけ。「参照から外れた画像キーを削除キューに登録する」処理はここではなく発火元と同一トランザクション（§5-2）で、非同期なのはキューを消化する定期バッチ（§8）だけ。**AI プロバイダ呼び出し（`POST /ai/proofread`・Phase 11）も `BackgroundTasks` ではない** — リクエストの内側で外部 I/O を行い（DB トランザクションは張らない・サーバー側 15 秒タイムアウト）、結果と 503（`AI_UNAVAILABLE`）をレスポンスに返す。§6 の行を正とする。

| 処理 | トリガー | 内容 | 冪等性 | 失敗時 | なぜ非同期か |
| --- | --- | --- | --- | --- | --- |
| 通知 fan-out（`followee_new_recipe`） | 公開レシピ作成 Tx 内で **outbox 行**を 1 行 INSERT（`notification_outbox`: event / recipe_id / author_id / created_at / processed_at）。コミット後に `BackgroundTasks` が起動 | 未処理 outbox 行を `FOR UPDATE SKIP LOCKED` で排他確保 → `follows` で `followee_id = 投稿者` を引いて `notifications` に一括 `INSERT ... ON CONFLICT DO NOTHING` → `processed_at` をセット、を 1 Tx | 行の排他確保 ＋ `processed_at` ＋ 通知側の `(user_id, 'followee_new_recipe', recipe_id)` 一意制約（`ON CONFLICT DO NOTHING`）で、`BackgroundTasks` とスイープが同時に走っても二重にならない | `BackgroundTasks` が落ちても outbox 行が残り、**未処理 outbox を拾う定期スイープ**（§8）が後で配布する。**受信者は配布実行時点の `follows` で決まる**（下記） | フォロワー数だけ INSERT するので重い。投稿者を待たせない |

## 8. 定期バッチの台帳（cron / コンテナスケジューラ → 管理 CLI コマンド）

| ジョブ | 目的 | 冪等性 | 頻度 | 失敗時 | なぜバッチか |
| --- | --- | --- | --- | --- | --- |
| カウント列補正ジョブ | `follows` / `favorites` / `recipe_comments` を実数集計し `users.*_count` / `recipes.*_count` のズレを補正 | 何度流しても同じ（実数に寄せるだけ） | → [todo.md](todo.md) #10 | 次回実行で回収。多層防御なので 1 回の失敗は許容 | 通常はトランザクション内で正しく増減される。これは残余のズレを直す保険で、リアルタイム性は不要 |
| 一時アップロード GC | (a) `stored` で本参照されないまま猶予を過ぎた行、(b) `expires_at` を過ぎた `pending` 行（失敗したアップロード）を回収。各行を `FOR UPDATE SKIP LOCKED` でロック → 状態を再確認（`consumed` は除外）→ **同一 Tx でキーを削除キューに INSERT ＋ `uploads` 行を DELETE**。実 DELETE はストレージ削除ジョブが行う（§9） | 行ロック＋再確認で冪等。GC は外部 I/O をしない | 猶予・`expires_at` → [todo.md](todo.md) #15 | 次回実行で回収 | 「本参照されなかったか」「アップロードが完了したか」は時間が経たないと確定しない。即時判定できない |
| ストレージ削除ジョブ | 削除キュー（§9）のキーを S3 / MinIO から実削除し、成功した行を消す | 「既に存在しない」を成功扱い | → [todo.md](todo.md)（新規） | `attempts` を増やして再試行。上限超過は `last_error` を残して隔離 | ストレージ障害を削除 API に波及させない。遅延は許容 |
| 期限切れリフレッシュトークン掃除 | `refresh_tokens` の `expires_at < now()` かつ十分古い行を物理削除 | 対象を都度判定 | → [todo.md](todo.md)（新規） | 次回実行で回収 | 認証の正しさは検証時の期限チェックで担保済み。物理削除は容量最適化なので急がない |
| 通知 outbox スイープ | `processed_at IS NULL` かつ一定時間以上前の `notification_outbox` 行を処理し、fan-out をやり直す（`BackgroundTasks` の取りこぼし回収） | 通知側の一意制約で重複作成しない。`processed_at` をセット | → [todo.md](todo.md) #18 | 次回実行で回収 | プロセス断でも通知が最終的に届くことを保証する多層防御。数分〜数十分の遅延は許容 |
| 古い通知の掃除 | 保持期間を超えた既読通知 ＋ 処理済み `notification_outbox` 行を削除 | 対象を都度判定 | 保持期間 → [todo.md](todo.md) #18 | 次回実行で回収 | 通知は履歴。古いものの掃除に即時性は不要 |
| 閲覧履歴のトリミング | ユーザーあたり上限を超えた `recipe_views` を削除（挿入時トリミングを選ばない場合） | 対象を都度判定 | 方式 → [todo.md](todo.md) #9d | 次回実行で回収 | 上限超過分の掃除で、閲覧体験に影響しない |
| `ai_usage` の日次処理（Phase 11） | レート制限をアプリ内カウンタで持つ場合の日次リセット / 集計 | 日付キーで冪等 | → [todo.md](todo.md) #45 | 次回実行で回収 | 日次境界の処理でリクエスト経路に乗せる必要がない |

## 9. アップロード管理と削除キュー（物理スキーマは Phase 3 で確定）

### 一時アップロード管理（`uploads` 想定）

- キーはアップロード前に**行の INSERT で確定**する（`POST /images` の①）。オブジェクトだけが存在して行が無い、という状態を作らない。
- 状態: `pending`（行だけ作成、アップロード進行中）→ `stored`（オブジェクト保存済み・本参照待ち）→ `consumed`（本参照された）。
- 各 `pending` 行は `expires_at` を持つ（= `now()` ＋ サーバーのリクエストタイムアウトより十分長い猶予）。
- **競合の直列化は行ロックで行う**（[non-functional.md](non-functional.md) の方針と同じ）。次の 3 者は同じ `uploads` 行を `SELECT ... FOR UPDATE` してから進む:
  - `POST /images` の③: 行をロック → まだ `pending` なら `stored` に更新してコミット。**行が消えていた / `expires_at` を過ぎていたら③は失敗**し、②で書いたオブジェクトを削除キューに登録してから 5xx を返す（削除済み扱いのキーを `{key, url}` として返さない）。
  - 本参照する書き込み（レシピ / 感想の `POST` / `PUT` / `PATCH`）: 行をロック → `stored` かつ本人所有を確認して同一トランザクションで `consumed` にする。
  - GC（§8）: `expires_at` を過ぎた `pending` 行、または `stored` のまま猶予を過ぎた行を `FOR UPDATE SKIP LOCKED` でロック → ロック後にもう一度状態を確認（`consumed` になっていたら対象外）→ **同一トランザクションで、そのキーを削除キューに INSERT し `uploads` 行を DELETE**。GC 自身は外部 I/O をしない（実 DELETE はストレージ削除ジョブに任せる）。
- 所有者（`user_id`）と消費状態を保持し、「本人所有かつ未使用（`stored`）or 更新対象自身に紐付け済み」だけを本参照に使える（[image.md](features/image.md)）。

### 削除キュー（`pending_storage_deletions` 想定）

- 「参照から外れたオブジェクトキー」をためる。列の例: `key` / `reason` / `enqueued_at` / `attempts` / `last_error`。
- **登録は発火元と同一トランザクション**（§5-2）。コミットされれば必ず後で消される。
- **CASCADE 削除より前にキーを集める**: 行が消えた後ではキーを取り出せない。レシピ削除では CASCADE で消える `recipes.thumbnail_key` / `steps.image_key` / そのレシピへの `recipe_comments.image_key` を、アカウント削除ではさらに `users.avatar_key` と本人所有で未消費の `uploads`（`pending` / `stored`）のキーを、先に SELECT して削除キューに INSERT してから DELETE する。
- **冪等**: 同一キーの重複登録を許容し、削除ジョブ側で「既に無い」を成功として扱う。

物理スキーマ（`uploads` の状態列 / 専用テーブルの別立て）の確定は **Phase 3（画像）**（→ [todo.md](todo.md) #32）。

### 通知 outbox（`notification_outbox` 想定・Phase 8）

- fan-out（`followee_new_recipe`）の配布指示を貯める。列の例: `id` / `event` / `recipe_id` / `author_id` / `created_at` / `processed_at`（NULL = 未処理）。
- 公開レシピ作成トランザクション内で 1 行 INSERT（発火とアトミック）。`BackgroundTasks` が即時処理し、落ちた分は定期スイープ（§8）が拾う。
- **並行処理の安全化**: 処理側（`BackgroundTasks` / スイープ）は未処理行を `FOR UPDATE SKIP LOCKED` で確保してから処理する。`notifications` への INSERT は `(user_id, 'followee_new_recipe', recipe_id)` 一意制約 ＋ `ON CONFLICT DO NOTHING`。両方あるので二重起動しても通知は重複せず、途中失敗した行は `processed_at` が NULL のまま次回に再処理される。
- **受信者の決定時点**: 受信者は「その outbox 行を処理した時点」の `follows` で決まる。`BackgroundTasks` が即時成功する通常運用では投稿とほぼ同時刻。障害でスイープ回収が数分遅れた場合、その間のフォロー増減が反映される（遅れて届く / 届かない）。`followee_new_recipe` は「フォロー中ユーザーの新着を知る」ためのもので、遅延回収時に**その時点のフォロワー**へ届くのは自然な挙動として**許容する**（通知はベストエフォート）。
- 物理スキーマは Phase 8 で確定（→ [todo.md](todo.md) #18）。

## 10. クライアント側の同期 / 非同期整合（framework 非依存）

- **トークンリフレッシュ**: single-flight（同時に何本リフレッシュが必要になっても実行は 1 本、他はその結果を待つ。[auth.md](features/auth.md)）。
- **閲覧記録**: レシピ詳細の取得成功後に `POST /recipes/{id}/view` を fire-and-forget（失敗は無視。[view-history.md](features/view-history.md) / [screens/recipe-detail.md](screens/recipe-detail.md)）。
- **通知バッジ**: 他 destination 滞在中に `GET /notifications/unread-count` をポーリングするか・間隔は → [todo.md](todo.md) #34。
- **AI チェック（Phase 11）**: 非同期・陳腐化ガード・構造変更で修正案を破棄（[ai-proofread.md](features/ai-proofread.md)）。
- **♡ / フォローのボタン**: 楽観更新（押した瞬間に表示と数を ±1、API 失敗で元に戻す。[screens/recipe-detail.md](screens/recipe-detail.md) / [screens/user-profile.md](screens/user-profile.md) / [screens/connections.md](screens/connections.md)）。フィード一覧の並び・件数の反映は再取得時（[home-feed.md](features/home-feed.md)）。同時操作はサーバー側の行ロックで直列化されるためクライアントの再試行は不要。

## 11. 受け入れ基準（この文書の内部整合）

- [ ] 全 `features/*.md` の主要な書き込み操作が §6 の表に 1 行以上ある
- [ ] §6 の各トランザクション境界が、対応する `features/*.md` と [non-functional.md](non-functional.md) の記述と矛盾しない
- [ ] fan-out が「非同期（`BackgroundTasks`）」で確定し、[todo.md](todo.md) #18・[non-functional.md](non-functional.md)・[roadmap.md](roadmap.md) Phase 8 と一致する
- [ ] §3 に設計判断と理由の一覧があり、§7 / §8 の各行にも理由がある
- [ ] §2 に、ユーザーがこれまで挙げていない技術・方式の初心者向け説明（説明＋なぜ必要か＋代替案）がある
- [ ] §8 の各バッチに対応する Phase が [roadmap.md](roadmap.md) にある

## 12. 未確定（→ [todo.md](todo.md)）

- 本番のジョブ実行基盤（cron / コンテナスケジューラ / 将来の専用ジョブキュー）の具体と、多重起動防止の方法
- 各定期バッチの実行頻度
- ストレージ削除キューの物理スキーマ（Phase 3）
- 通知・期限切れリフレッシュトークンの保持期間
- 大量フォロワー時の fan-out 性能測定と、専用ジョブキュー導入の判断（Phase 10 以降）
