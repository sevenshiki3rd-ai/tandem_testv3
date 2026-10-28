## v5.1.1 修正点
- 開始操作時に START!、停止操作時に STOP を表示するよう修正。
- ホームの表示名を「ニンジンタスク 🎣🥕」に変更。ブラウザタイトルとPWA名も更新。
- Service Workerキャッシュを更新。
- Supabaseの設定・SQL・通知関連コードはv5.1から変更なし。

# ニンジンタスク v5.1 — Push通知対応コード

v5のUIと同期機能に加えて、以下のプッシュ通知を追加しました。

- 発破されたときのプッシュ通知（赤）
- 「🥕 進んでる？」の毎時通知（日本時間8〜22時、未完了タスクがある場合）
- 設定画面からそれぞれON/OFF（初期状態OFF）
- iPhoneホーム画面PWA・Android対応ブラウザ向けPush API / Service Worker

**注意：ZIPをGitHubにアップロードするだけではプッシュ通知は届きません。** Supabase Edge Functionと定期実行の設定が必要です。詳細は `PUSH_SETUP.md` を参照してください。

## v5の通常利用
1. Supabaseプロジェクトを作成し、匿名認証を有効化する。
2. `supabase.sql` をSQL Editorで実行する。
3. `config.js` に公開用Supabase URL、publishable key、VAPID公開鍵を設定する。
4. 静的ファイルをGitHub Pagesに配置する。
5. `PUSH_SETUP.md` に従いEdge Functionをデプロイし、毎時実行を設定する。

秘密鍵・service_role・Cronシークレットを公開リポジトリに置かないでください。
