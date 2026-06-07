// シート名の設定
const MASTER_SHEET_NAME = 'マスターデータ';
const INPUT_SHEET_NAME = '入庫記録';

// ブラウザでURLを開いたときにアプリ画面を表示する
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('医薬品期限チェック')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------
// 以下はアプリからのデータ受け取り用処理
// ---------------------------------------------------------

// GS1(14桁)からマスターデータを検索
function searchGs1(gs1Code) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  
  if (!sheet) return { success: false, message: 'マスターデータシートが見つかりません' };

  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const masterGs1 = String(row[2]).trim();
    if (masterGs1 === String(gs1Code).trim()) {
      return { success: true, name: String(row[1]), unit: String(row[4]) };
    }
  }
  return { success: false, message: 'マスターに登録がありません' };
}

// 読み取ったデータを「入庫記録」シートに保存する
function saveData(record) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INPUT_SHEET_NAME);
  
  if (!sheet) return { success: false, message: '入庫記録シートが見つかりません' };

  const barcodeFormula = record.shelf ? `=IMAGE("https://barcode.tec-it.com/barcode.ashx?data=" & ENCODEURL("${record.shelf}"))` : "";

  sheet.appendRow([
    record.timestamp,
    record.gs1,
    record.name,
    record.lot,
    record.expDate,
    record.disposalDate,
    record.shelf,
    record.quantity,
    record.unit,
    record.category,
    barcodeFormula
  ]);

  return { success: true };
}
