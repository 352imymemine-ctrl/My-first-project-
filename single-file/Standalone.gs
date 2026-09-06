// ============================================
// 設定：この3つを自分の値に書き換える
// フォルダはURLをそのまま貼ってOK（IDだけでも可）
// ============================================
var NY_FOLDER = 'NYフォルダのURL';
var SAVE_FOLDER = '保存先の親フォルダのURL';
var API_KEY = 'GeminiのAPIキー';

var REVIEW_FOLDER = '要確認';

// 使うAIのモデル。提供終了で404が出たら、エラーメッセージが案内する新しい名前にここを書き換える
var MODEL = 'gemini-3.6-flash';

// ============================================
// メイン処理（定期実行もこの関数を呼ぶ）
// ============================================
function runOrganize() {
  var from = openFolder(NY_FOLDER);
  var to = openFolder(SAVE_FOLDER);
  var existing = getExistingCategories(to);

  var files = [];
  collectFiles(from, files);

  var done = [];
  var review = [];
  var retry = [];

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    try {
      var r = classify(file, existing);

      // API側の一時的な失敗（回数制限など）は、動かさずに次回の実行で再挑戦する
      if (r.error) {
        retry.push(file.getName());
        continue;
      }

      // 既存フォルダと表記ゆれで重複しそうな場合も、勝手に新規作成せず要確認にする
      var duplicateRisk = r.similar && existing.indexOf(r.category) === -1;

      if (r.confidence !== 'high' || duplicateRisk) {
        moveInto(file, to, REVIEW_FOLDER);
        review.push({
          name: file.getName(),
          guess: r.category,
          similar: r.similar,
          reason: duplicateRisk ? ('既存の「' + r.similar + '」と同じ科目かもしれません') : '内容から科目を判定できませんでした'
        });
      } else {
        moveInto(file, to, r.category);
        if (existing.indexOf(r.category) === -1) existing.push(r.category);
        done.push(file.getName() + ' → ' + r.category);
      }
    } catch (err) {
      review.push({ name: file.getName(), guess: '-', similar: '', reason: 'エラー: ' + err.message });
    }
  }

  removeEmptyFolders(from);
  Logger.log('仕分け: ' + done.length + '件 / 要確認: ' + review.length + '件 / 次回再挑戦: ' + retry.length + '件');
  if (done.length > 0 || review.length > 0 || retry.length > 0) sendReport(done, review, retry, to);
}

// ============================================
// Driveの操作
// ============================================

// DriveのフォルダURLでもID単体でも受け取れるようにする
function openFolder(urlOrId) {
  var m = String(urlOrId).match(/[-\w]{25,}/);
  if (!m) throw new Error('フォルダのURLまたはIDが正しくありません: ' + urlOrId);
  return DriveApp.getFolderById(m[0]);
}

// 保存先にすでにあるフォルダ名 = 既存カテゴリ（要確認フォルダは除く）
function getExistingCategories(parent) {
  var names = [];
  var folders = parent.getFolders();
  while (folders.hasNext()) {
    var n = folders.next().getName();
    if (n !== REVIEW_FOLDER) names.push(n);
  }
  return names;
}

// サブフォルダの中まで再帰的にファイルを集める
function collectFiles(folder, list) {
  var files = folder.getFiles();
  while (files.hasNext()) list.push(files.next());
  var subs = folder.getFolders();
  while (subs.hasNext()) collectFiles(subs.next(), list);
}

function moveInto(file, parent, folderName) {
  var found = parent.getFoldersByName(folderName);
  var target = found.hasNext() ? found.next() : parent.createFolder(folderName);
  file.moveTo(target);
}

// 中身が空になったサブフォルダを掃除する（folder自体は残す）
function removeEmptyFolders(folder) {
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    removeEmptyFolders(sub);
    if (!sub.getFiles().hasNext() && !sub.getFolders().hasNext()) sub.setTrashed(true);
  }
}

// ============================================
// Geminiで科目を判定
// ============================================
function classify(file, existing) {
  var mime = file.getMimeType();
  if (mime !== 'application/pdf' && mime !== 'image/png' && mime !== 'image/jpeg') {
    return { category: '未分類', confidence: 'low', similar: '' };
  }

  var prompt = 'これは学習ノート（GoodNotesから書き出したPDFまたは画像）です。内容から科目名を判定してください。'
    + '既存のカテゴリ一覧: [' + existing.join(', ') + ']。'
    + '既存カテゴリと同じ科目なら、その名称をそのまま使ってください。'
    + '次のJSON形式だけを出力してください: '
    + '{"category":"科目名","confidence":"high または low","similar":"既存カテゴリの中で同じ科目を指している可能性がある名前。無ければ空文字"}。'
    + '文字が読み取れない、複数科目にまたがる等で自信が持てない場合はconfidenceを必ずlowにしてください。'
    + 'similarは、categoryが既存カテゴリと完全一致しないが同じ科目かもしれない場合（例:「医療統計」と「医療統計学」）にのみ入れてください。';

  var payload = {
    contents: [{
      parts: [
        { inlineData: { mimeType: mime, data: Utilities.base64Encode(file.getBlob().getBytes()) } },
        { text: prompt }
      ]
    }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' }
  };

  var res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + API_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }
  );

  if (res.getResponseCode() != 200) {
    Logger.log('APIエラー: ' + res.getContentText());
    return { error: true };
  }

  var json = JSON.parse(res.getContentText());
  if (!json.candidates || !json.candidates[0]) return { category: '未分類', confidence: 'low', similar: '' };

  try {
    var out = JSON.parse(json.candidates[0].content.parts[0].text);
    var category = clean(out.category);
    if (!category) return { category: '未分類', confidence: 'low', similar: '' };
    return {
      category: category,
      confidence: out.confidence === 'high' ? 'high' : 'low',
      similar: clean(out.similar)
    };
  } catch (err) {
    return { category: '未分類', confidence: 'low', similar: '' };
  }
}

// フォルダ名に使えない文字を落とす
function clean(text) {
  if (!text) return '';
  return String(text).trim().split('\n')[0].replace(/[\/\\:*?"<>|「」『』]/g, '').slice(0, 30);
}

// ============================================
// 結果をメールで報告
// ============================================
function sendReport(done, review, retry, parent) {
  var body = '■ 自動で仕分けしました（' + done.length + '件）\n';
  body += done.length ? done.join('\n') : '（なし）';

  body += '\n\n■ 確認してほしいファイル（' + review.length + '件）\n';
  if (review.length === 0) {
    body += '（なし）';
  } else {
    for (var i = 0; i < review.length; i++) {
      var r = review[i];
      body += '\n・' + r.name + '\n  AIの推測: ' + r.guess + '\n  理由: ' + r.reason + '\n';
    }
    body += '\nこれらは「' + REVIEW_FOLDER + '」フォルダに入れてあります。\n';
    body += 'Driveで開いて、正しい科目フォルダに移動してください（新しく作ってもOKです）。\n';
    body += parent.getUrl();
  }

  if (retry.length > 0) {
    body += '\n\n■ 今回は処理できなかったファイル（' + retry.length + '件）\n';
    body += retry.join('\n');
    body += '\n\nAPIの一時的なエラーです。元の場所に残してあるので、次回の自動実行で再挑戦します。';
  }

  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[資料整理] ' + done.length + '件を仕分け / ' + review.length + '件は要確認', body);
}

// ============================================
// 定期実行のON/OFF（1回だけ手で実行する）
// ============================================
function enableSchedule() {
  disableSchedule();
  ScriptApp.newTrigger('runOrganize').timeBased().everyHours(3).create();
  Logger.log('定期実行をONにしました（3時間ごと）');
}

function disableSchedule() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runOrganize') ScriptApp.deleteTrigger(triggers[i]);
  }
  Logger.log('定期実行をOFFにしました');
}
