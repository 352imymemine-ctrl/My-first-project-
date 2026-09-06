# My-first-project-

GoodNotesの資料をGoogle Drive上で自動分類・仕分けするGoogle Apps Scriptです。

## できること

- Google Drive内の「未整理」フォルダに入れたGoodNotes資料（PDF/画像）を、Gemini APIで内容を解析して科目・分野ごとに自動分類
- 分類結果に応じて科目別フォルダを自動作成し、ファイルを移動
- 時間主導型トリガーで定期実行（デフォルト3時間ごと）
- 実行結果とカテゴリ一覧をスプレッドシートにログとして記録

## できないこと（制約）

Google NotebookLMには2026年時点で公開APIが提供されていないため、ノートブックの自動作成・自動でのソース追加はできません。
このスクリプトは代わりに「カテゴリ一覧」シートにNotebookLM連携が必要な科目フォルダを記録するので、そこから**手動で**NotebookLMのノートブックを作成し、「ソースを追加 > Google Drive」で対応するフォルダを指定してください。一度フォルダをソースとして追加すれば、以降そのフォルダに増えるファイルはNotebookLM側の同期機能で反映されます。

## セットアップ手順

1. 新しいGoogleスプレッドシートを作成する（これがログ表示・設定用の画面になります）。
2. 「拡張機能 > Apps Script」を開き、`apps-script/` フォルダ内の各ファイル（`Code.gs`, `Config.gs`, `Classifier.gs`, `Organizer.gs`, `Triggers.gs`, `Logging.gs`, `appsscript.json`）の内容をそれぞれ同名のファイルとしてコピーする。
   - `clasp` を使う場合は `apps-script/` をルートにして `clasp push` でも可。
3. Apps Scriptエディタで「サービス」から Drive API (v3) を追加する（`appsscript.json` に既に記載済みなので `clasp push` の場合は自動で有効化されます）。
4. Google Driveに「未整理」フォルダと、分類先の親フォルダ（例:「整理済み」）を作成する。
5. スプレッドシートを開き直すとメニュー「資料整理」が表示されるので、「初期設定」から以下を入力する。
   - 未整理フォルダのURLまたはID
   - 分類先の親フォルダのURLまたはID
   - Gemini APIキー（https://aistudio.google.com/apikey で取得）
6. 「今すぐ実行」で動作確認する。
7. 問題なければ「定期実行をONにする」で自動実行を有効化する。

## ファイル構成

- `Code.gs` - スプレッドシートのカスタムメニュー定義
- `Config.gs` - 設定値の保存・読み込み（スクリプトプロパティ）
- `Classifier.gs` - Gemini APIによるファイル内容の分類
- `Organizer.gs` - 未整理フォルダのスキャンと仕分けのメイン処理
- `Triggers.gs` - 定期実行トリガーのON/OFF
- `Logging.gs` - 実行ログ・カテゴリ一覧シートへの記録
- `appsscript.json` - Apps Scriptプロジェクトのマニフェスト
