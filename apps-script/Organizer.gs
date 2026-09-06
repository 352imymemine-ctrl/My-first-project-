/**
 * メイン処理: 「未整理」フォルダ内のファイルをAI分類し、
 * カテゴリ別フォルダへ移動する。
 * GoodNotesの自動バックアップがサブフォルダ構造で書き出す場合に備え、
 * 「未整理」フォルダ配下は再帰的に探索する。
 *
 * 判定に自信が持てないファイル、または重複フォルダの疑いがあるファイルは
 * 自動で振り分けず「要確認」フォルダに避難させ、人が resolvePendingReviews() で
 * 仕分け先を決める（定期実行中はダイアログを出せないため）。
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
  var reviewCount = 0;

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    try {
      var result = classifyFile(file, existingCategories);
      var isDuplicateRisk = result.similarExisting && existingCategories.indexOf(result.category) === -1;
      var needsReview = result.confidence === 'low' || isDuplicateRisk;

      if (needsReview) {
        var reviewFolder = getOrCreateSubfolder(organizedRoot, '要確認');
        file.moveTo(reviewFolder);
        var reason = result.confidence === 'low'
          ? '内容の判定に自信が持てないファイル'
          : ('既存カテゴリ「' + result.similarExisting + '」と同じ科目の可能性があり、重複フォルダを避けるため要確認');
        logReviewItem(file, result.category, result.similarExisting, result.confidence, reason);
        logFileRun(file.getName(), result.category, reviewFolder.getUrl(), '要確認へ');
        reviewCount++;
      } else {
        if (existingCategories.indexOf(result.category) === -1) {
          existingCategories.push(result.category);
        }
        var targetFolder = getOrCreateSubfolder(organizedRoot, result.category);
        file.moveTo(targetFolder);
        logFileRun(file.getName(), result.category, targetFolder.getUrl(), 'OK');
        upsertCategoryRow(result.category, targetFolder.getUrl());
      }
      processed++;
    } catch (err) {
      logFileRun(file.getName(), '-', '', 'エラー: ' + err.message);
    }
  }

  removeEmptySubfolders(unorganizedFolder);

  if (reviewCount > 0) {
    notifyPendingReview(reviewCount);
  }

  return { processed: processed, reviewCount: reviewCount };
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
 * 「要確認」フォルダは中身がある限り残る。
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
    var result = runOrganize();
    var message = result.processed + ' 件のファイルを処理しました。';
    if (result.reviewCount > 0) {
      message += '\nうち ' + result.reviewCount + ' 件は判定に自信が持てず「要確認」フォルダへ避難させました。' +
        'メニューの「要確認ファイルを仕分けする」から内容を確認してください。';
    }
    ui.alert(message + '\n詳細は「実行ログ」シートを確認してください。');
  } catch (err) {
    ui.alert('エラー: ' + err.message);
  }
}

/**
 * 「要確認」キューに溜まったファイルを1件ずつ確認し、保存先フォルダを決める。
 * 定期実行では呼べない（ui.promptは人が操作しているときしか使えない）ため、
 * メニューから手動で実行する。
 */
function resolvePendingReviews() {
  var ui = SpreadsheetApp.getUi();
  var config = getConfig();
  var organizedRoot = DriveApp.getFolderById(config.organizedRootFolderId);
  var rows = getUnresolvedReviewRows();

  if (rows.length === 0) {
    ui.alert('未処理の要確認ファイルはありません。');
    return;
  }

  var resolvedCount = 0;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i].values;
    var fileId = row[REVIEW_COL.FILE_ID];
    var fileName = row[REVIEW_COL.FILE_NAME];
    var suggested = row[REVIEW_COL.SUGGESTED];
    var similar = row[REVIEW_COL.SIMILAR];
    var reason = row[REVIEW_COL.REASON];

    var file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (err) {
      markReviewRowResolved(rows[i].rowIndex);
      continue;
    }

    var message =
      'ファイル: ' + fileName + '\n' +
      'AIの推定カテゴリ: ' + suggested + '\n' +
      (similar ? ('似ている既存カテゴリ: ' + similar + '\n') : '') +
      '理由: ' + reason + '\n\n' +
      '保存先のフォルダ名を入力してください。\n' +
      '・既存フォルダを使う → その名前をそのまま入力\n' +
      '・新しいフォルダを作る → 新しい名前を入力\n' +
      '・後で決める(スキップ) → 何も入力せずOK';

    var response = ui.prompt(
      '要確認ファイルの仕分け (' + (i + 1) + '/' + rows.length + ')',
      message,
      ui.ButtonSet.OK_CANCEL
    );

    if (response.getSelectedButton() !== ui.Button.OK) {
      break;
    }

    var folderName = response.getResponseText().trim();
    if (!folderName) {
      continue;
    }

    var targetFolder = getOrCreateSubfolder(organizedRoot, folderName);
    file.moveTo(targetFolder);
    upsertCategoryRow(folderName, targetFolder.getUrl());
    logFileRun(fileName, folderName, targetFolder.getUrl(), '要確認から手動で仕分け');
    markReviewRowResolved(rows[i].rowIndex);
    resolvedCount++;
  }

  ui.alert(resolvedCount + ' 件のファイルを仕分けしました。');
}
