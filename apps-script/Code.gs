/**
 * スプレッドシートを開いたときにメニューを追加する。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('資料整理')
    .addItem('今すぐ実行', 'runOrganizeFromMenu')
    .addSeparator()
    .addItem('初期設定', 'showSetupDialog')
    .addSeparator()
    .addItem('定期実行をONにする（3時間ごと）', 'enableSchedule')
    .addItem('定期実行をOFFにする', 'disableScheduleFromMenu')
    .addToUi();
}
