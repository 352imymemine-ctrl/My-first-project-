/**
 * 定期実行（時間主導型トリガー）のON/OFF。
 */

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
