/**
 * Gemini API を使い、ファイルの中身（PDF/画像）から科目・カテゴリ名を推定する。
 * 判定に自信が持てない場合や、既存カテゴリと表記ゆれで重複しそうな場合は
 * confidence / similarExisting を通じて呼び出し側に伝え、要確認扱いにする。
 */

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
