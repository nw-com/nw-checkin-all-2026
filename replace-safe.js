const fs = require('fs');

// Read the file with UTF-8 encoding
let content = fs.readFileSync('patrol.html', 'utf8');

// Create a map of replacements, replace longer patterns first to avoid partial matches
const replacements = [
    // First replace specific function names
    ['normalizeInspectionItems', 'normalizeCheckItems'],
    ['normalizeInspectionItemsByCode', 'normalizeCheckItemsByCode'],
    ['getDefaultInspectionItems', 'getDefaultCheckItems'],
    ['getInspectionItemsForCode', 'getCheckItemsForCode'],
    ['resolveInspectionTargetLabel', 'resolveCheckTargetLabel'],
    ['renderInspectionSettingsList', 'renderCheckSettingsList'],
    ['openInspectionSettingsModal', 'openCheckSettingsModal'],
    ['closeInspectionSettingsModal', 'closeCheckSettingsModal'],
    ['addInspectionItemFromInput', 'addCheckItemFromInput'],
    ['removeInspectionItem', 'removeCheckItem'],
    ['saveInspectionItems', 'saveCheckItems'],
    ['renderInspectionRunItems', 'renderCheckRunItems'],
    ['toggleInspectionSelectAll', 'toggleCheckSelectAll'],
    ['updateInspectionSelectAllState', 'updateCheckSelectAllState'],
    ['openInspectionRunModal', 'openCheckRunModal'],
    ['closeInspectionRunModal', 'closeCheckRunModal'],
    ['confirmInspectionAndCheckIn', 'confirmCheckAndCheckIn'],
    ['openInspectionStatusModal', 'openCheckStatusModal'],
    ['closeInspectionStatusModal', 'closeCheckStatusModal'],
    ['recordPatrolIn', 'recordCheckIn'],
    ['renderPatrolPointsTags', 'renderCleanPointsTags'],
    
    // Then variable names
    ['inspectionItemsByCode', 'checkItemsByCode'],
    ['defaultInspectionItems', 'defaultCheckItems'],
    ['inspectionEditingCode', 'checkEditingCode'],
    ['inspectionEditingItems', 'checkEditingItems'],
    ['pendingInspectionScan', 'pendingCheckScan'],
    ['locationMap', 'cleanLocationMap'],
    
    // Then text replacements
    ['巡邏打卡系統', '清潔打卡系統'],
    ['智慧巡邏系統', '智慧清潔系統'],
    ['已巡邏', '已清潔'],
    ['巡邏點', '清潔點'],
    ['資深保全', '資深清潔員'],
    ['例如：巡邏點確認', '例如：清潔點確認'],
    ['開始巡邏打卡', '開始清潔打卡'],
    ['請對準巡邏點', '請對準清潔點'],
    ['此次巡視', '此次檢查'],
    ['巡視確認', '檢查確認'],
    ['檢查項目', '檢查項目'], // Keep as is, no change
    ['巡視項目設定', '檢查項目設定'],
    ['預覽巡邏打卡明細', '預覽清潔打卡明細'],
    ['下載巡邏打卡明細', '下載清潔打卡明細'],
    ['巡邏歷史紀錄', '清潔歷史紀錄'],
    ['分享巡邏記錄', '分享清潔記錄'],
    ['編輯巡邏記錄', '編輯清潔記錄'],
    ['設定巡邏週期', '設定清潔週期'],
    ['每天巡邏', '每天清潔'],
    ['每日次數', '每日次數'],
    ['每週幾', '每週幾'],
    ['隔週幾', '隔週幾'],
    ['每月幾日', '每月幾日'],
    ['patrol', 'clean'],
    ['Patrol', 'Clean'],
    ['inspection', 'check'],
    ['Inspection', 'Check'],
    ['patrol', 'clean'],
    ['Patrol', 'Clean']
];

// Perform replacements
replacements.forEach(([from, to]) => {
    // Use word boundaries to avoid partial matches in variable names
    const regex = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    content = content.replace(regex, to);
});

// Special handling for mixed cases where capitalization
content = content.replace(/patrol/g, 'clean');
content = content.replace(/Patrol/g, 'Clean');
content = content.replace(/inspection/g, 'check');
content = content.replace(/Inspection/g, 'Check');

// Write back
fs.writeFileSync('clean.html', content, 'utf8');
console.log('File updated successfully!');
