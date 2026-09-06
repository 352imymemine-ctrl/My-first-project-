/**
 * Gemini API を使い、ファイルの中身（PDF/画像）から科目・カテゴリ名を推定する。
 */

var SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg'
];

/**
 * ファイルを分類し、カテゴリ名（例: "数学", "英語"）を返す。
 * 判定できない場合は "未分類" を返す。
 */
function classifyFile(file, existingCategories) {
  var config = getConfig();
  var mimeType = file.getMimeType();

  if (SUPPORTED_MIME_TYPES.indexOf(mimeType) === -1) {
    return '未分類';
  }

  var base64Data = Utilities.base64Encode(file.getBlob().getBytes());
  var prompt =
    'これは学習ノート（GoodNotesから書き出したPDFまたは画像）です。' +
    '内容から最も適切な科目・分野名を1つだけ日本語の単語または短いフレーズで答えてください。' +
    '既存のカテゴリ一覧: [' + (existingCategories || []).join(', ') + ']。' +
    '内容が既存カテゴリのいずれかに合致する場合は、その名称をそのまま使ってください。' +
    '一致するものがなければ新しい科目名を提案してください。' +
    '説明や記号は一切付けず、カテゴリ名のみを出力してください。';

  var payload = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Data } },
          { text: prompt }
        ]
      }
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 20 }
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
    return '未分類';
  }

  var json = JSON.parse(response.getContentText());
  var text = json.candidates && json.candidates[0] && json.candidates[0].content &&
    json.candidates[0].content.parts && json.candidates[0].content.parts[0] &&
    json.candidates[0].content.parts[0].text;

  var category = sanitizeCategoryName(text);
  return category || '未分類';
}

function sanitizeCategoryName(text) {
  if (!text) return '';
  var cleaned = text.trim().split('\n')[0];
  cleaned = cleaned.replace(/^[「『"'\s]+|[」』"'\s。.]+$/g, '');
  // Drive のフォルダ名に使えない文字を除去
  cleaned = cleaned.replace(/[\/\\:*?"<>|]/g, '');
  return cleaned.slice(0, 30);
}
