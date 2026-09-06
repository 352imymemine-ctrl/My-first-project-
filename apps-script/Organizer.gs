/**
 * メイン処理: 「未整理」フォルダ内のファイルをAI分類し、
 * カテゴリ別フォルダへ移動する。
 * GoodNotesの自動バックアップがサブフォルダ構造で書き出す場合に備え、
 * 「未整理」フォルダ配下は再帰的に探索する。
 */

function runOrganize() {
  var config = getConfig();
  assertConfigured(config);

  var unorganizedFolder = DriveApp.getFolderById(config.unorganizedFolderId);
  var organizedRoot = DriveApp.getFolderById(config.organizedRootFolderId);
  var existingCategories = getExistingCategories();

  var files = [];
  collectFilesRecursively(unorganizedFolder, files);

  var processed = 0;
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
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

  removeEmptySubfolders(unorganizedFolder);

  return processed;
}

/**
 * folder配下（サブフォルダを含む）の全ファイルをfileListに集める。
 */
function collectFilesRecursively(folder, fileList) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    fileList.push(files.next());
  }

  var subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    collectFilesRecursively(subfolders.next(), fileList);
  }
}

/**
 * folder配下の空になったサブフォルダを削除する（folder自体は残す）。
 * GoodNotesが自動生成した分類フォルダの抜け殻を掃除するため。
 */
function removeEmptySubfolders(folder) {
  var subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    var subfolder = subfolders.next();
    removeEmptySubfolders(subfolder);
    if (!subfolder.getFiles().hasNext() && !subfolder.getFolders().hasNext()) {
      subfolder.setTrashed(true);
    }
  }
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
