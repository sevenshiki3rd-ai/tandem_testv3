# v5.1 プッシュ通知の導入（Supabase接続後）

このZIPをGitHub Pagesに置くだけでは**外部プッシュ通知は動作しません**。以下のサーバー設定が必要です。v5の既存機能はそのまま使えます。

## 1. DB
Supabase SQL Editorで `supabase.sql` を実行。v5ですでに実行済みでも `create ... if not exists` と既存ポリシーの再作成を含むため、通常は再実行できます。既存データのバックアップを推奨します。

## 2. VAPIDキーを生成
Node.jsを使えるPCで `npx web-push generate-vapid-keys` を実行。公開鍵は `config.js` の `vapidPublicKey` に貼り付けます。**秘密鍵はGitHubへアップロードしないこと。**

## 3. Supabase Edge Functionをデプロイ
Supabase CLIをセットアップしてログインし、プロジェクトをリンクします。

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set VAPID_PUBLIC_KEY="YOUR_PUBLIC_KEY" VAPID_PRIVATE_KEY="YOUR_PRIVATE_KEY" VAPID_CONTACT_EMAIL="YOUR_EMAIL" NINJIN_CRON_SECRET="LONG_RANDOM_SECRET"
supabase functions deploy ninjin-push --no-verify-jwt
```

`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は通常、Edge Function環境で提供されます。自動で提供されない環境ではSupabaseの秘密設定で追加してください。**これらを `config.js` に書かないこと。**

`--no-verify-jwt` は匿名認証ユーザーの新しいJWT方式への互換性のためです。関数内では発破送信時に `auth.getUser` でトークンを検証し、定期通知では `X-Ninjin-Cron-Secret` を検証します。

## 4. 1時間ごとの実行を登録
SupabaseのCron機能（pg_cron/pg_net）または信頼できる外部スケジューラから、毎時1回以下へPOSTを設定します。

- URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/ninjin-push`
- Method: POST
- Headers: `Content-Type: application/json`, `X-Ninjin-Cron-Secret: LONG_RANDOM_SECRET`
- Body: `{"action":"hourly"}`
- Schedule: `0 * * * *` (UTCでも毎時0分は同じ)

**CronシークレットはGitHubの公開ファイルに保存しないこと。** Supabase VaultやスケジューラのSecret管理に保管してください。SupabaseのCron画面に認証ヘッダーを安全に設定できない場合は、Vault + pg_netで設定する必要があります。

## 5. GitHub Pagesを更新
ZIPの**ルートの静的ファイル**をアップロード（`supabase/` ディレクトリはEdge Functionデプロイ用で、GitHub Pagesへのアップロード不要）。設定の「プッシュ通知」で発破・毎時リマインダーをONにしてください。

## 仕様・制約
- 発破: 発破を送った直後に通知送信を試行。受信者が発破通知をONにしている場合のみ。
- 定期: 毎時1回、**日本時間8〜22時**、本人の未完了タスクがある場合のみ。デフォルトOFF（本人の同意が必要）。
- iPhone: iOS 16.4以降、Safariからホーム画面に追加したWebアプリで許可が必要。Androidは対応ブラウザで許可。
- OSの省電力制御・通知設定・通信状況によって遅延・不達が起こり得ます。
- 既存のアプリ内の発破・承認表示は引き続き使用できます。承認はプッシュ通知しません。
- 4桁PIN復旧は未実装です。
- サーバーの稼働確認、実機でのプッシュ受信確認は未実施です。
