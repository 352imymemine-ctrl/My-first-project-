/**
 * 設定値の読み書き。API キーやフォルダ ID はコードに直書きせず
 * スクリプトプロパティ（ファイル > プロジェクトの設定）に保存する。
 */

var CONFIG_KEYS = {
  UNORGANIZED_FOLDER_ID: 'UNORGANIZED_FOLDER_ID',
  ORGANIZED_ROOT_FOLDER_ID: 'ORGANIZED_ROOT_FOLDER_ID',
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  GEMINI_MODEL: 'GEMINI_MODEL'
};

var DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

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
