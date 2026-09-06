/**
 * 実行結果、カテゴリ一覧、要確認キューをスプレッドシートに記録する。
 * NotebookLM には公開APIが無いため通知は作らず、この一覧を見て
 * 手動で「NotebookLMのノートブックにDriveフォルダをソース追加」してもらう想定。
 */

var RUN_LOG_SHEET_NAME = '実行ログ';
var CATEGORY_SHEET_NAME = 'カテゴリ一覧';
var REVIEW_SHEET_NAME = '要確認';
var REVIEW_HEADERS = ['日時', 'ファイルID', 'ファイル名', '現在の場所URL', 'AI提案カテゴリ', '類似する既存カテゴリ', 'confidence', '理由', '状態'];
var REVIEW_COL = { DATE: 0, FILE_ID: 1, FILE_NAME: 2, LOCATION_URL: 3, SUGGESTED: 4, SIMILAR: 5, CONFIDENCE: 6, REASON: 7, STATUS: 8 };

function getOrCreateSheet(name, headerRow) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headerRow);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logFileRun(fileName, category, folderUrl, status) {
  var sheet = getOrCreateSheet(RUN_LOG_SHEET_NAME, ['日時', 'ファイル名', 'カテゴリ', 'フォルダURL', '結果']);
  sheet.appendRow([new Date(), fileName, category, folderUrl, status]);
}

/**
 * カテゴリ一覧シートに行が無ければ追加する。
 * 「NotebookLM連携済み」列はユーザーが手動でチェックする運用。
 */
function upsertCategoryRow(category, folderUrl) {
  var sheet = getOrCreateSheet(CATEGORY_SHEET_NAME, ['カテゴリ', 'フォルダURL', 'NotebookLM連携済み', '最終更新日時']);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === category) {
      sheet.getRange(i + 1, 4).setValue(new Date());
      return;
    }
  }
  sheet.appendRow([category, folderUrl, false, new Date()]);
}

function getExistingCategories() {
  var sheet = getOrCreateSheet(CATEGORY_SHEET_NAME, ['カテゴリ', 'フォルダURL', 'NotebookLM連携済み', '最終更新日時']);
  var data = sheet.getDataRange().getValues();
  var categories = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) categories.push(data[i][0]);
  }
  return categories;
}

/**
 * 判定に自信が持てない、または重複フォルダの疑いがあるファイルを要確認キューに積む。
 */
function logReviewItem(file, suggestedCategory, similarExisting, confidence, reason) {
  var sheet = getOrCreateSheet(REVIEW_SHEET_NAME, REVIEW_HEADERS);
  sheet.appendRow([
    new Date(), file.getId(), file.getName(), file.getUrl(),
    suggestedCategory, similarExisting || '', confidence, reason, '未処理'
  ]);
}

function getUnresolvedReviewRows() {
  var sheet = getOrCreateSheet(REVIEW_SHEET_NAME, REVIEW_HEADERS);
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][REVIEW_COL.STATUS] !== '処理済み') {
      rows.push({ rowIndex: i + 1, values: data[i] });
    }
  }
  return rows;
}

function markReviewRowResolved(rowIndex) {
  var sheet = getOrCreateSheet(REVIEW_SHEET_NAME, REVIEW_HEADERS);
  sheet.getRange(rowIndex, REVIEW_COL.STATUS + 1).setValue('処理済み');
}

/**
 * 要確認ファイルが新たに発生したことを、スクリプトの所有者本人にメールで知らせる。
 * 定期実行（無人実行）はダイアログを出せないため、代わりにメールで気づけるようにする。
 */
function notifyPendingReview(count) {
  var email = Session.getEffectiveUser().getEmail();
  if (!email) return;
  MailApp.sendEmail(
    email,
    '[資料整理] 要確認ファイルが' + count + '件あります',
    '自動分類の判定に自信が持てなかった、または重複フォルダの疑いがあるファイルが' + count + '件見つかりました。\n' +
    'スプレッドシートのメニュー「資料整理」→「要確認ファイルを仕分けする」から内容を確認し、保存先を決めてください。'
  );
}
