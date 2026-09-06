/**
 * 資料自動仕分けスクリプト（1ファイル版）
 *
 * apps-script/ 内の6ファイルを1つにまとめたもの。
 * iPadなどで「拡張機能 > Apps Script」にコピペするとき、1回の貼り付けで済むように用意している。
 *
 * 注意: apps-script/ の6ファイル版と併用しないこと（関数が重複して動かなくなる）。
 * どちらか一方だけを使う。
 */


// ============================================================
// メニュー
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('資料整理')
    .addItem('今すぐ実行', 'runOrganizeFromMenu')
    .addItem('要確認ファイルを仕分けする', 'resolvePendingReviews')
    .addSeparator()
    .addItem('初期設定', 'showSetupDialog')
    .addSeparator()
    .addItem('定期実行をONにする（3時間ごと）', 'enableSchedule')
    .addItem('定期実行をOFFにする', 'disableScheduleFromMenu')
    .addToUi();
}


// ============================================================
// 設定（APIキーやフォルダIDはスクリプトプロパティに保存する）
// ============================================================

var CONFIG_KEYS = {
  UNORGANIZED_FOLDER_ID: 'UNORGANIZED_FOLDER_ID',
  ORGANIZED_ROOT_FOLDER_ID: 'ORGANIZED_ROOT_FOLDER_ID',
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  GEMINI_MODEL: 'GEMINI_MODEL'
};

var DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function getConfig() {
  var props = PropertiesService.getScriptProperties().getProperties();
  return {
    unorganizedFolderId: props[CONFIG_KEYS.UNORGANIZED_FOLDER_ID] || '',
    organizedRootFolderId: props[CONFIG_KEYS.ORGANIZED_ROOT_FOLDER_ID] || '',
    geminiApiKey: props[CONFIG_KEYS.GEMINI_API_KEY] || '',
    geminiModel: props[CONFIG_KEYS.GEMINI_MODEL] || DEFAULT_GEMINI_MODEL
  };
}

function assertConfigured(config) {
  var missing = [];
  if (!config.unorganizedFolderId) missing.push('未整理フォルダ');
  if (!config.organizedRootFolderId) missing.push('分類先ルートフォルダ');
  if (!config.geminiApiKey) missing.push('Gemini APIキー');
  if (missing.length > 0) {
    throw new Error('初期設定が未完了です（「資料整理」メニュー→「初期設定」）: ' + missing.join('、'));
  }
}

/**
 * Drive のフォルダ URL または ID どちらを渡されても ID を返す。
 */
function extractFolderId(urlOrId) {
  var trimmed = (urlOrId || '').trim();
  var match = trimmed.match(/[-\w]{25,}/);
  return match ? match[0] : trimmed;
}

function showSetupDialog() {
  var ui = SpreadsheetApp.getUi();
  var current = getConfig();
  var props = PropertiesService.getScriptProperties();

  var res1 = ui.prompt(
    '初期設定 (1/3)',
    'GoodNotes資料を入れる「未整理」フォルダの URL または ID を入力してください。\n現在値: ' + current.unorganizedFolderId,
    ui.ButtonSet.OK_CANCEL
  );
  if (res1.getSelectedButton() !== ui.Button.OK) return;
  var unorganizedId = extractFolderId(res1.getResponseText());
  if (unorganizedId) props.setProperty(CONFIG_KEYS.UNORGANIZED_FOLDER_ID, unorganizedId);

  var res2 = ui.prompt(
    '初期設定 (2/3)',
    '分類後のフォルダ（科目別フォルダ）を作成する親フォルダの URL または ID を入力してください。\n現在値: ' + current.organizedRootFolderId,
    ui.ButtonSet.OK_CANCEL
  );
  if (res2.getSelectedButton() !== ui.Button.OK) return;
  var organizedId = extractFolderId(res2.getResponseText());
  if (organizedId) props.setProperty(CONFIG_KEYS.ORGANIZED_ROOT_FOLDER_ID, organizedId);

  var res3 = ui.prompt(
    '初期設定 (3/3)',
    'Gemini API キーを入力してください（https://aistudio.google.com/apikey で取得）。\n未入力のままにすると現在の値を維持します。',
    ui.ButtonSet.OK_CANCEL
  );
  if (res3.getSelectedButton() !== ui.Button.OK) return;
  var apiKey = res3.getResponseText().trim();
  if (apiKey) props.setProperty(CONFIG_KEYS.GEMINI_API_KEY, apiKey);

  ui.alert('初期設定を保存しました。「今すぐ実行」で動作確認してください。');
}


// ============================================================
// 分類（Gemini API）
// ============================================================

var SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg'
];

/**
 * ファイルを分類する。戻り値:
 * { category: string, confidence: 'high'|'low', similarExisting: string }
 */
function classifyFile(file, existingCategories) {
  var config = getConfig();
  var mimeType = file.getMimeType();

  if (SUPPORTED_MIME_TYPES.indexOf(mimeType) === -1) {
    return { category: '未分類', confidence: 'low', similarExisting: '' };
  }

  var base64Data = Utilities.base64Encode(file.getBlob().getBytes());
  var prompt =
    'これは学習ノート（GoodNotesから書き出したPDFまたは画像）です。' +
    '内容から最も適切な科目・分野名を判定してください。' +
    '既存のカテゴリ一覧: [' + (existingCategories || []).join(', ') + ']。' +
    '内容が既存カテゴリのいずれかと同じであれば、その名称をそのまま使ってください。' +
    '一致するものがなければ新しい科目名を提案してください。' +
    '次のJSON形式で、余計な説明を一切付けずに1つだけ出力してください: ' +
    '{"category": "判定した科目名", "confidence": "high または low", "similar_existing": "既存カテゴリの中で同じ科目を指している可能性がある名前。無ければ空文字"}。' +
    'confidenceは、文字が読み取れない・内容が複数科目にまたがる・専門的すぎて判断できない等の理由で自信が持てない場合は必ず"low"にしてください。' +
    'similar_existingは、あなたが提案するcategoryが既存カテゴリと完全一致はしないが、表記ゆれ等で同じ科目を指している可能性がある場合（例:「医療統計」と「医療統計学」）にのみ、その既存カテゴリ名を入れてください。';

  var payload = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Data } },
          { text: prompt }
        ]
      }
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json' }
  };

  var url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    config.geminiModel + ':generateContent?key=' + config.geminiApiKey;

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('Gemini API error for ' + file.getName() + ': ' + response.getContentText());
    return { category: '未分類', confidence: 'low', similarExisting: '' };
  }

  var json = JSON.parse(response.getContentText());
  var text = json.candidates && json.candidates[0] && json.candidates[0].content &&
    json.candidates[0].content.parts && json.candidates[0].content.parts[0] &&
    json.candidates[0].content.parts[0].text;

  return parseClassificationResult(text);
}

function parseClassificationResult(text) {
  try {
    var parsed = JSON.parse(text);
    var category = sanitizeCategoryName(parsed.category);
    if (!category) {
      return { category: '未分類', confidence: 'low', similarExisting: '' };
    }
    return {
      category: category,
      confidence: parsed.confidence === 'high' ? 'high' : 'low',
      similarExisting: sanitizeCategoryName(parsed.similar_existing || '')
    };
  } catch (err) {
    // JSONとして解釈できない場合は要確認に回す
    return { category: sanitizeCategoryName(text) || '未分類', confidence: 'low', similarExisting: '' };
  }
}

function sanitizeCategoryName(text) {
  if (!text) return '';
  var cleaned = String(text).trim().split('\n')[0];
  cleaned = cleaned.replace(/^[「『"'\s]+|[」』"'\s。.]+$/g, '');
  // Drive のフォルダ名に使えない文字を除去
  cleaned = cleaned.replace(/[\/\\:*?"<>|]/g, '');
  return cleaned.slice(0, 30);
}


// ============================================================
// メイン処理（仕分け）
// ============================================================

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


// ============================================================
// 定期実行トリガー
// ============================================================

var TRIGGER_HANDLER = 'runOrganize';

function enableSchedule() {
  disableSchedule();
  ScriptApp.newTrigger(TRIGGER_HANDLER)
    .timeBased()
    .everyHours(3)
    .create();
  SpreadsheetApp.getUi().alert('定期実行をONにしました（3時間ごとに自動仕分けします）。');
}

function disableSchedule() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function disableScheduleFromMenu() {
  disableSchedule();
  SpreadsheetApp.getUi().alert('定期実行をOFFにしました。');
}


// ============================================================
// ログ・カテゴリ一覧・要確認キュー
// ============================================================

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
