/**
 * メイン処理: 「未整理」フォルダ内のファイルをAI分類し、
 * カテゴリ別フォルダへ移動する。
 */

function runOrganize() {
  var config = getConfig();
  assertConfigured(config);

  var unorganizedFolder = DriveApp.getFolderById(config.unorganizedFolderId);
  var organizedRoot = DriveApp.getFolderById(config.organizedRootFolderId);
  var files = unorganizedFolder.getFiles();
  var existingCategories = getExistingCategories();

  var processed = 0;
  while (files.hasNext()) {
    var file = files.next();
    try {
      var category = classifyFile(file, existingCategories);
      if (existingCategories.indexOf(category) === -1) {
        existingCategories.push(category);
      }

      var targetFolder = getOrCreateSubfolder(organizedRoot, category);
      file.moveTo(targetFolder);

      logFileRun(file.getName(), category, targetFolder.getUrl(), 'OK');
      upsertCategoryRow(category, targetFolder.getUrl());
      processed++;
    } catch (err) {
      logFileRun(file.getName(), '-', '', 'エラー: ' + err.message);
    }
  }

  return processed;
}

function getOrCreateSubfolder(parentFolder, name) {
  var subfolders = parentFolder.getFoldersByName(name);
  if (subfolders.hasNext()) {
    return subfolders.next();
  }
  return parentFolder.createFolder(name);
}

/**
 * メニューの「今すぐ実行」から呼ばれる。結果をダイアログで表示する。
 */
function runOrganizeFromMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    var count = runOrganize();
    ui.alert(count + ' 件のファイルを分類・整理しました。詳細は「実行ログ」シートを確認してください。');
  } catch (err) {
    ui.alert('エラー: ' + err.message);
  }
}
