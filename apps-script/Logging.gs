/**
 * 実行結果と、NotebookLM 連携が必要なカテゴリ一覧をスプレッドシートに記録する。
 * NotebookLM には公開APIが無いため通知は作らず、この一覧を見て
 * 手動で「NotebookLMのノートブックにDriveフォルダをソース追加」してもらう想定。
 */

var RUN_LOG_SHEET_NAME = '実行ログ';
var CATEGORY_SHEET_NAME = 'カテゴリ一覧';

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
