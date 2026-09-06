// ===== 設定：この3つを自分の値に書き換える =====
var NY_FOLDER_ID = 'NYフォルダのID';
var SAVE_FOLDER_ID = '保存先の親フォルダのID';
var API_KEY = 'GeminiのAPIキー';
// ============================================

function runTest() {
  var from = DriveApp.getFolderById(NY_FOLDER_ID);
  var to = DriveApp.getFolderById(SAVE_FOLDER_ID);
  var files = from.getFiles();
  var count = 0;

  while (files.hasNext()) {
    var file = files.next();
    var name = classify(file);
    var found = to.getFoldersByName(name);
    var target = found.hasNext() ? found.next() : to.createFolder(name);
    file.moveTo(target);
    Logger.log(file.getName() + ' → ' + name);
    count++;
  }

  Logger.log('完了: ' + count + '件');
}

function classify(file) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + API_KEY;
  var payload = {
    contents: [{
      parts: [
        { inlineData: { mimeType: file.getMimeType(), data: Utilities.base64Encode(file.getBlob().getBytes()) } },
        { text: 'この学習ノートの科目名を1つだけ、短い日本語で答えてください。説明は不要です。' }
      ]
    }]
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() != 200) {
    Logger.log('APIエラー: ' + res.getContentText());
    return '未分類';
  }

  var json = JSON.parse(res.getContentText());
  if (!json.candidates || !json.candidates[0]) {
    Logger.log('判定できず: ' + res.getContentText());
    return '未分類';
  }

  var text = json.candidates[0].content.parts[0].text;
  return text.trim().replace(/[\/\\:*?"<>|]/g, '').slice(0, 30);
}
