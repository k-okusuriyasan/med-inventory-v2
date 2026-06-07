const els = {
    btnScanOcr: document.getElementById('btn-scan-ocr'),
    btnStopScan: document.getElementById('btn-stop-scan'),
    scanStatus: document.getElementById('scan-status'),
    readerContainer: document.getElementById('reader-container'),
    
    form: document.getElementById('med-form'),
    gs1Code: document.getElementById('gs1-code'),
    medName: document.getElementById('med-name'),
    lotNumber: document.getElementById('lot-number'),
    expDate: document.getElementById('exp-date'),
    categoryFlag: document.getElementById('category-flag'),
    disposalDate: document.getElementById('disposal-date'),
    shelfNumber: document.getElementById('shelf-number'),
    quantity: document.getElementById('quantity'),
    unit: document.getElementById('unit'),
    btnSubmit: document.getElementById('btn-submit'),
    
    loader: document.getElementById('loader'),
    loaderText: document.getElementById('loader-text'),
    
    btnSettings: document.getElementById('btn-settings'),
    settingsModal: document.getElementById('settings-modal'),
    gasUrlInput: document.getElementById('gas-url'),
    secretTokenInput: document.getElementById('secret-token'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnSyncMaster: document.getElementById('btn-sync-master'),
    syncStatus: document.getElementById('sync-status'),
    statusIndicator: document.getElementById('status-indicator')
};

let html5QrcodeScanner = null;
let gasWebhookUrl = localStorage.getItem('gasWebhookUrl') || '';
let secretToken = localStorage.getItem('secretToken') || '';

// Initialize PWA Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(() => console.log('Service Worker Registered'))
        .catch(err => console.error('Service Worker Failed', err));
}

// Load Settings
if (gasWebhookUrl) {
    els.gasUrlInput.value = gasWebhookUrl;
    els.secretTokenInput.value = secretToken;
    els.statusIndicator.textContent = 'GAS接続準備OK';
    els.statusIndicator.style.color = 'var(--success-color)';
} else {
    els.statusIndicator.textContent = '設定からGAS URLを入力してください';
    els.statusIndicator.style.color = 'var(--danger-color)';
}

// Settings Handlers
els.btnSettings.addEventListener('click', () => els.settingsModal.classList.remove('hidden'));
els.btnSaveSettings.addEventListener('click', () => {
    const url = els.gasUrlInput.value.trim();
    const token = els.secretTokenInput.value.trim();
    if (url) {
        localStorage.setItem('gasWebhookUrl', url);
        localStorage.setItem('secretToken', token);
        gasWebhookUrl = url;
        secretToken = token;
        els.settingsModal.classList.add('hidden');
        els.statusIndicator.textContent = 'GAS接続準備OK';
        els.statusIndicator.style.color = 'var(--success-color)';
        alert('設定を保存しました');
    } else {
        alert('URLを入力してください');
    }
});

// Sync Master Data
els.btnSyncMaster.addEventListener('click', async () => {
    if (!gasWebhookUrl) {
        alert('先にGAS Webhook URLを保存してください');
        return;
    }
    els.syncStatus.textContent = 'マスターデータをダウンロード中... (数秒〜十数秒かかります)';
    els.btnSyncMaster.disabled = true;
    try {
        const response = await fetch(gasWebhookUrl, {
            method: 'POST',
            body: JSON.stringify({ action: 'sync_master', token: secretToken })
        });
        const result = await response.json();
        if (result.success) {
            localStorage.setItem('masterData', JSON.stringify(result.data));
            els.syncStatus.textContent = `完了: ${Object.keys(result.data).length}件の医薬品を保存しました`;
            els.syncStatus.style.color = 'var(--success-color)';
        } else {
            els.syncStatus.textContent = 'エラー: ' + result.message;
            els.syncStatus.style.color = 'var(--danger-color)';
        }
    } catch (e) {
        console.error(e);
        els.syncStatus.textContent = '通信エラーが発生しました';
        els.syncStatus.style.color = 'var(--danger-color)';
    }
    els.btnSyncMaster.disabled = false;
});

// Loading UI
function showLoader(text = '処理中...') {
    els.loaderText.textContent = text;
    els.loader.classList.remove('hidden');
}
function hideLoader() {
    els.loader.classList.add('hidden');
}

// --- GS1 Parsing Logic ---
// GS1-128 / DataMatrix often concatenates. AI 01 (14 chars), 17 (6 chars), 10 (variable).
// Sometimes they have FNC1 separators, but standard JS decoders might just return raw strings or prefix with ]d2
function parseGS1(data) {
    // Remove symbology identifier if present (e.g. ]d2 or ]C1)
    let cleanData = data.replace(/^\]\w{2}/, '');
    // 一部のスキャナは(01)のように括弧を含めて返すため、括弧を取り除く
    cleanData = cleanData.replace(/[()]/g, '');
    let result = { gs1: '', exp: '', lot: '' };
    
    // Simple parsing (Assuming format (01)14digits(17)6digits(10)lot)
    // We try to match AI codes. Since FNC1 might be stripped, we use regex.
    // 01 is exactly 14 digits, 17 is exactly 6 digits. 10 is variable.
    // E.g., 011453790510041725053110AB123
    
    let pointer = 0;
    while (pointer < cleanData.length) {
        let ai = cleanData.substring(pointer, pointer + 2);
        if (ai === '01') {
            result.gs1 = cleanData.substring(pointer + 2, pointer + 16);
            pointer += 16;
        } else if (ai === '17') {
            result.exp = cleanData.substring(pointer + 2, pointer + 8);
            pointer += 8;
        } else if (ai === '10') {
            // Lot is variable up to 20 chars, usually ends at end of string or FNC1(Group separator \x1D)
            let endPointer = cleanData.indexOf(String.fromCharCode(29), pointer);
            if (endPointer === -1) endPointer = cleanData.length;
            result.lot = cleanData.substring(pointer + 2, endPointer);
            pointer = endPointer + 1; // skip separator if found
        } else if (ai === '21') { // Serial number
            let endPointer = cleanData.indexOf(String.fromCharCode(29), pointer);
            if (endPointer === -1) endPointer = cleanData.length;
            pointer = endPointer + 1;
        } else {
            // Unknown AI, break to prevent infinite loop
            break;
        }
    }
    return result;
}

// Date Calculation (Disposal Date)
function calculateDisposalDate() {
    const expStr = els.expDate.value;
    if (!expStr || !expStr.includes('-')) return;
    
    const parts = expStr.split('-');
    if (parts.length !== 2) return;
    
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    
    // Set to 1st day of the month
    let exp = new Date(y, m - 1, 1); 

    const flag = els.categoryFlag.value;
    let monthsToSubtract = 3;
    if (flag === '半錠等') monthsToSubtract = 6;
    else if (flag === '移し替え等') monthsToSubtract = 1;
    else if (flag === '経腸栄養剤') monthsToSubtract = 2;

    // 当月を含めるため、引く月数を-1する
    exp.setMonth(exp.getMonth() - (monthsToSubtract - 1));
    
    // Format YYYY/MM
    const outY = exp.getFullYear();
    const outM = String(exp.getMonth() + 1).padStart(2, '0');
    els.disposalDate.value = `${outY}/${outM}`;
}

els.categoryFlag.addEventListener('change', calculateDisposalDate);
els.expDate.addEventListener('input', calculateDisposalDate);

// Handle manual GS1 code edits
els.gs1Code.addEventListener('input', () => {
    const code = els.gs1Code.value.trim();
    if (code.length === 14) {
        fetchMasterData(code);
    }
});
els.gs1Code.addEventListener('blur', () => {
    const code = els.gs1Code.value.trim();
    if (code) {
        fetchMasterData(code);
    }
});

// Fetch Master Data from Local Cache (Instant)
async function fetchMasterData(gs1Code) {
    const cachedData = localStorage.getItem('masterData');
    if (cachedData) {
        const masterData = JSON.parse(cachedData);
        let targetData = masterData[gs1Code];
        
        // 【重要】マスターデータの調剤コードが13桁（先頭の0がない状態）で登録されている場合の対策
        // 読み取ったコードが14桁で、かつ先頭が '0' の場合、先頭の '0' を除いた13桁でも検索を試す
        if (!targetData && gs1Code.length === 14 && gs1Code.startsWith('0')) {
            targetData = masterData[gs1Code.substring(1)];
        }
        
        if (targetData) {
            let salesGs1 = gs1Code;
            
            // もし値が文字列なら、それは調剤コードから販売コードへの「リンク」なので、リンク先を読み込む
            if (typeof targetData === 'string') {
                salesGs1 = targetData;
                targetData = masterData[salesGs1];
            }
            
            if (targetData) {
                // 圧縮版(配列)と旧版(オブジェクト)の両方に自動対応
                const name = Array.isArray(targetData) ? targetData[0] : targetData.name;
                const unit = Array.isArray(targetData) ? targetData[1] : targetData.unit;
                
                els.medName.value = name || ''; 
                els.unit.value = unit || '';    
                els.gs1Code.value = salesGs1;      // 自動変換
                
                els.scanStatus.textContent = 'マスター取得完了！';
                els.scanStatus.style.color = 'var(--success-color)';
                els.btnSubmit.disabled = false;
                return;
            }
        }
    }
    
    // Not found in cache
    els.medName.value = '';
    els.unit.value = '';
    if (!cachedData) {
        els.scanStatus.textContent = 'マスターデータが同期されていません。設定からダウンロードしてください。';
    } else {
        els.scanStatus.textContent = 'マスターに未登録です (手入力可)';
    }
    els.scanStatus.style.color = 'var(--danger-color)';
    els.btnSubmit.disabled = false;
}

// Handle Scanned Data
async function handleScanSuccess(decodedText) {
    const parsed = parseGS1(decodedText);
    
    // （調剤包装単位(0)でも処理を続行するためアラートは削除しました）

    stopScanner();
    els.scanStatus.textContent = '読み取り成功！データを解析中...';
    
    if (!parsed.gs1) {
        els.scanStatus.textContent = 'GS1データではありません';
        els.scanStatus.style.color = 'var(--danger-color)';
        return;
    }

    els.gs1Code.value = parsed.gs1;
    els.expDate.value = parsed.exp;
    els.lotNumber.value = parsed.lot;
    
    calculateDisposalDate();
    showLoader('マスターデータ照会中...');
    await fetchMasterData(parsed.gs1);
    hideLoader();
}

// HTML5-QRCode scanner has been removed entirely in favor of AI OCR.

function stopScanner() {
    els.btnScanOcr.classList.remove('hidden');
    els.btnStopScan.classList.add('hidden');
    const existingCaptureBtn = document.getElementById('capture-btn');
    if (existingCaptureBtn) existingCaptureBtn.remove();
}

els.btnStopScan.addEventListener('click', stopScanner);

// --- OCR Scanner Setup (Fallback) ---
// Simplified OCR logic: open camera, take picture, run Tesseract
async function startOCR(mode = 'full') {
    els.scanStatus.textContent = '現在OCRカメラを準備中...';
    
    // Create a hidden video element and canvas to capture image
    const video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.style.width = '100%';
    video.style.height = '300px'; // 縦幅を狭く固定
    video.style.objectFit = 'cover'; // 枠に合わせてはみ出した部分を隠す
    video.style.display = 'block';
    
    // UI枠用コンテナ
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = '100%';
    wrapper.style.backgroundColor = '#000';
    wrapper.style.overflow = 'hidden'; // 影がはみ出すのを防ぐ
    
    // 読み取りガイド枠 (中央横長)
    const guide = document.createElement('div');
    guide.style.position = 'absolute';
    guide.style.top = '50%'; 
    guide.style.left = '50%';
    guide.style.transform = 'translate(-50%, -50%)';
    guide.style.width = '85%';
    guide.style.height = '120px'; // バーコードに最適な高さ
    guide.style.border = '3px solid #00ff00';
    guide.style.boxShadow = '0 0 0 4000px rgba(0,0,0,0.6)';
    guide.style.pointerEvents = 'none';
    guide.style.boxSizing = 'border-box';
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = stream;
        
        wrapper.appendChild(video);
        wrapper.appendChild(guide);
        
        // 対象期限の計算と表示
        const today = new Date();
        today.setMonth(today.getMonth() + 13); // 1年1ヶ月後
        const targetY = today.getFullYear();
        const targetM = String(today.getMonth() + 1).padStart(2, '0');
        
        const targetLabel = document.createElement('div');
        targetLabel.style.position = 'absolute';
        targetLabel.style.top = '10px';
        targetLabel.style.left = '50%';
        targetLabel.style.transform = 'translateX(-50%)';
        targetLabel.style.backgroundColor = 'rgba(255, 71, 87, 0.9)';
        targetLabel.style.color = 'white';
        targetLabel.style.padding = '8px 16px';
        targetLabel.style.borderRadius = '20px';
        targetLabel.style.fontWeight = 'bold';
        targetLabel.style.fontSize = '1.1rem';
        targetLabel.style.zIndex = '20';
        targetLabel.style.whiteSpace = 'nowrap'; // ← 改行を防ぐ
        targetLabel.innerHTML = `期限チェック対象年月日<br>${targetY}年${targetM}月以前`;
        targetLabel.style.textAlign = 'center';
        wrapper.appendChild(targetLabel);
        
        els.readerContainer.innerHTML = '';
        els.readerContainer.appendChild(wrapper);
        els.readerContainer.style.display = 'block';
        
        
        els.btnScanOcr.classList.add('hidden');
        els.btnStopScan.classList.remove('hidden');
        
        els.scanStatus.innerHTML = '緑の枠内に<b>「GS1コードとその上下の数字すべて」</b>を収め、「撮影」ボタンを押してください。';
        els.scanStatus.style.color = 'var(--primary-color)';
        
        // Add Capture Button (カメラ枠の外側、スキャン停止ボタンの横に配置)
        const existingBtn = document.getElementById('capture-btn');
        if (existingBtn) existingBtn.remove();
        
        const captureBtn = document.createElement('button');
        captureBtn.id = 'capture-btn';
        captureBtn.className = 'btn btn-primary';
        captureBtn.style.color = '#ffffff';
        captureBtn.style.fontWeight = 'bold';
        captureBtn.textContent = '📸 撮影';
        
        const btnGroup = document.querySelector('.button-group');
        btnGroup.insertBefore(captureBtn, els.btnStopScan);

        captureBtn.onclick = async () => {
            captureBtn.disabled = true;
            els.scanStatus.textContent = '文字認識(OCR)を実行中...数秒かかります';
            showLoader('画像から文字を抽出中...');
            
            // 実際の動画サイズと表示上のサイズの比率を計算して正確にクロップする
            const videoRect = video.getBoundingClientRect();
            const guideRect = guide.getBoundingClientRect();
            
            const scale = Math.max(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight);
            
            const displayedWidth = video.videoWidth * scale;
            const displayedHeight = video.videoHeight * scale;
            
            const offsetX = (videoRect.width - displayedWidth) / 2;
            const offsetY = (videoRect.height - displayedHeight) / 2;
            
            // CSSピクセル上のガイド位置を実際の動画ピクセルに変換
            const guideLeftInVideo = (guideRect.left - videoRect.left) - offsetX;
            const guideTopInVideo = (guideRect.top - videoRect.top) - offsetY;
            
            const sx = guideLeftInVideo / scale;
            const sy = guideTopInVideo / scale;
            const sWidth = guideRect.width / scale;
            const sHeight = guideRect.height / scale;

            const canvas = document.createElement('canvas');
            canvas.width = sWidth;
            canvas.height = sHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
            
            // --- ここから画像前処理 (精度向上) ---
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // 1. グレースケール化と平均輝度の計算
            let totalLuminance = 0;
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                // NTSC係数によるグレースケール
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                data[i] = data[i+1] = data[i+2] = gray;
                totalLuminance += gray;
            }
            
            // 2. 黒背景(白抜き文字)の判定
            const avgLuminance = totalLuminance / (canvas.width * canvas.height);
            const isInverted = avgLuminance < 128; // 全体的に暗ければ黒背景とみなす
            
            // 3. 白黒反転とコントラスト強調
            for (let i = 0; i < data.length; i += 4) {
                let v = data[i];
                
                // 黒背景ならネガポジ反転して白背景にする
                if (isInverted) {
                    v = 255 - v;
                }
                
                // コントラストを極端に上げる (疑似的な二値化)
                if (v < 100) {
                    v = 0; // 完全に黒
                } else if (v > 155) {
                    v = 255; // 完全に白
                } else {
                    v = Math.round((v - 100) * (255 / 55));
                }
                
                data[i] = data[i+1] = data[i+2] = v;
            }
            ctx.putImageData(imageData, 0, 0);
            // --- ここまで画像前処理 ---
            
            stream.getTracks().forEach(track => track.stop());
            
            try {
                // 日本語モデル(jpn)を使用して、漢字の「製造番号」「使用期限」等も読み取れるようにする
                const worker = await Tesseract.createWorker("jpn");
                await worker.setParameters({
                    tessedit_pageseg_mode: '6' // 1つのテキストブロックとして認識
                });
                const result = await worker.recognize(canvas);
                await worker.terminate();
                
                parseOcrText(result.data.text, mode);
                
            } catch (err) {
                console.error(err);
                els.scanStatus.textContent = 'OCRエラーが発生しました';
            }
            hideLoader();
            els.readerContainer.innerHTML = '<div id="reader"></div>'; // reset
            stopScanner(); // reset buttons
        };
        
    } catch (err) {
        console.error(err);
        alert('カメラの起動に失敗しました。');
    }
}

function parseOcrText(text, mode) {
    console.log("OCR Text: ", text);
    // Remove spaces and newlines
    let cleanText = text.replace(/[\s\r\n]+/g, '');
    
    // 1. GS1の抽出 (01)
    let gs1Match = cleanText.match(/(?:\(01\)|01|\[01\]|【01】)(\d{14})/);
    let gs1 = gs1Match ? gs1Match[1] : (cleanText.match(/\b\d{14}\b/) ? cleanText.match(/\b\d{14}\b/)[0] : (text.match(/(?<!\d)\d{14}(?!\d)/) ? text.match(/(?<!\d)\d{14}(?!\d)/)[0] : ''));

    // 2. 期限の抽出 (17) または 年月表記
    // (17)の後に、空白やノイズがあっても「2または3から始まる6桁」を最優先で取得する
    let expMatchAI = cleanText.match(/(?:\(17\)|17|\[17\]|【17】)[^\d]*([23]\d{5})/);
    let exp = '';
    if (expMatchAI) {
        // AIが拾った場合は YYMMDD なので YYYY-MM に変換
        let yy = parseInt(expMatchAI[1].substring(0, 2), 10) + 2000;
        let mm = expMatchAI[1].substring(2, 4);
        exp = `${yy}-${mm}`;
    }
    if (!exp) {
        // YYYY.MM や YYYY.M の形式を探す
        let dateMatch = text.match(/([0-9]{4})[./年-]([0-9]{1,2})/);
        if (dateMatch) {
            let yy = dateMatch[1];
            let mm = String(parseInt(dateMatch[2], 10)).padStart(2, '0');
            exp = `${yy}-${mm}`;
        }
    }

    // 3. ロットナンバーの抽出 (10) または 漢字表記
    let lotMatchAI = cleanText.match(/(?:\(10\)|10|\[10\]|【10】)([A-Za-z0-9]{2,20})/);
    let lot = '';
    if (lotMatchAI) {
        lot = lotMatchAI[1];
        // 誤ってGS1まで繋がってしまった場合の切り捨て処理
        let nextAi = lot.indexOf('01149');
        if (nextAi === -1) nextAi = lot.indexOf('01049');
        if (nextAi > 0) {
            lot = lot.substring(0, nextAi);
        }
    }
    
    if (!lot) {
        // 漢字の「製造番号」「製造」「ロット」等の後にある英数字を探す
        let kanjiMatch = cleanText.match(/(?:製造番号|製造記号|製造|番号|ロット|ﾛｯﾄ)[:：]?([A-Za-z0-9]{2,15})/);
        if (kanjiMatch) {
            lot = kanjiMatch[1];
        }
    }
    
    if (lot) {
        lot = lot.replace(/[()]/g, '');
    }

    if (mode === 'partial') {
        // Partial mode was removed but keeping fallback logic just in case
        return;
    }

    if (exp) els.expDate.value = exp;
    else {
        // 読み取れなかった場合は現在の年月をセット（スロットの初期値用）
        const today = new Date();
        els.expDate.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    }

    if (lot) els.lotNumber.value = lot;
    calculateDisposalDate();

    if (!gs1) {
        els.scanStatus.textContent = 'OCRでGS1(14桁)を見つけられませんでした。手入力してください。';
        els.scanStatus.style.color = 'var(--danger-color)';
        return;
    }

    els.gs1Code.value = gs1;
    
    fetchMasterData(gs1);
}

els.btnScanOcr.addEventListener('click', () => startOCR('full'));

// --- Form Submission ---
els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!gasWebhookUrl) {
        alert('設定からGAS Webhook URLを入力してください');
        return;
    }

    const record = {
        timestamp: new Date().toLocaleString('ja-JP'),
        gs1: els.gs1Code.value,
        name: els.medName.value,
        lot: els.lotNumber.value,
        expDate: els.expDate.value,
        disposalDate: els.disposalDate.value,
        shelf: els.shelfNumber.value,
        quantity: els.quantity.value,
        unit: els.unit.value,
        category: els.categoryFlag.value
    };

    showLoader('スプレッドシートに保存中...');
    try {
        const response = await fetch(gasWebhookUrl, {
            method: 'POST',
            body: JSON.stringify({ action: 'save_data', record, token: secretToken })
        });
        const result = await response.json();
        
        if (result.success) {
            alert('正常に保存されました！');
            // Reset form for next item
            els.form.reset();
            els.scanStatus.textContent = '次のバーコードをスキャンしてください';
        } else {
            alert('エラー: ' + result.message);
        }
    } catch (err) {
        console.error(err);
        alert('通信エラーが発生しました。ネットワークを確認してください。');
    }
    hideLoader();
});
