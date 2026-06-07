/**
 * 医薬品期限チェックアプリ - Google Apps Script バックエンド
 * 
 * 【設定手順】
 * 1. スプレッドシートを開き、「拡張機能」>「Apps Script」をクリック
 * 2. このコードをコピー＆ペーストして保存
 * 3. 「デプロイ」>「新しいデプロイ」をクリック
 * 4. 種類の選択で「ウェブアプリ」を選ぶ
 * 5. アクセスできるユーザーを「全員」にして「デプロイ」
 * 6. 発行された「ウェブアプリのURL」をアプリ内の設定画面に入力する
 */

// シート名の設定
const MASTER_SHEET_NAME = 'マスターデータ';
const INPUT_SHEET_NAME = '入庫記録';

// セキュリティ用の合言葉（好きな文字列に変更してください）
const SECRET_TOKEN = 'pword1234';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // 合言葉の検証
    if (data.token !== SECRET_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, message: '認証エラー: 合言葉が一致しません' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const action = data.action;

    if (action === 'search_gs1') {
      return searchGs1(data.gs1);
    } else if (action === 'sync_master') {
      return syncMaster();
    } else if (action === 'save_data') {
      return saveData(data.record);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Invalid action' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GS1(14桁)からマスターデータを検索して医薬品名と単位を返す
function searchGs1(gs1Code) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'マスターデータシートが見つかりません' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const values = sheet.getDataRange().getValues();
  // 1行目はヘッダーと想定し2行目から検索
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    // C列(インデックス2)がGS1コード、B列(1)が医薬品名、E列(4)が単位
    const masterGs1 = String(row[2]).trim();
    if (masterGs1 === String(gs1Code).trim()) {
      return ContentService.createTextOutput(JSON.stringify({ 
        success: true, 
        name: String(row[1]), 
        unit: String(row[4]) 
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'マスターに登録がありません' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// マスターデータを全件取得する
function syncMaster() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'マスターデータシートが見つかりません' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const values = sheet.getDataRange().getValues();
  const masterData = {};
  
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const gs1 = String(row[2]).trim();
    if (gs1) {
      masterData[gs1] = {
        name: String(row[1]),
        unit: String(row[4])
      };
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ success: true, data: masterData }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 読み取ったデータを「入庫記録」シートに保存する
function saveData(record) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INPUT_SHEET_NAME);
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: '入庫記録シートが見つかりません' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // バーコード生成の数式 (CODE128形式を指定)
  const barcodeFormula = record.shelf ? `=IMAGE("https://barcode.tec-it.com/barcode.ashx?data=" & ENCODEURL("${record.shelf}") & "&code=Code128")` : "";

  sheet.appendRow([
    record.timestamp,     // A: 読取日時
    record.gs1,           // B: GS1コード
    record.name,          // C: 医薬品名
    record.lot,           // D: ロットナンバー
    record.expDate,       // E: 期限
    record.disposalDate,  // F: 廃棄予定日
    record.shelf,         // G: 棚番
    record.quantity,      // H: 数量
    record.unit,          // I: 単位
    record.category,      // J: 区分フラグ
    barcodeFormula        // K: 棚番用バーコード
  ]);

  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 動作確認用のGETリクエストハンドラ（ブラウザでURLを開いた時のため）
function doGet(e) {
  return ContentService.createTextOutput("Medication Inventory API is running.");
}
