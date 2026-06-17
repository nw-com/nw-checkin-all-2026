const fs = require('fs');

// Read the file with UTF-8 encoding
let content = fs.readFileSync('patrol.html', 'utf8');

// Replace text
content = content.replace(/巡邏/g, '清潔');
content = content.replace(/巡視/g, '檢查');
content = content.replace(/patrol/g, 'clean');
content = content.replace(/Patrol/g, 'Clean');
content = content.replace(/inspection/g, 'check');
content = content.replace(/Inspection/g, 'Check');
content = content.replace(/智慧巡邏系統/g, '智慧清潔系統');
content = content.replace(/巡邏打卡系統/g, '清潔打卡系統');
content = content.replace(/資深保全/g, '資深清潔員');
content = content.replace(/例如：巡邏點確認/g, '例如：清潔點確認');

// Replace Firebase data fields for independence
content = content.replace(/locationMap/g, 'cleanLocationMap');
content = content.replace(/inspectionItemsByCode/g, 'checkItemsByCode');
content = content.replace(/defaultInspectionItems/g, 'defaultCheckItems');
content = content.replace(/inspectionItems/g, 'checkItems');

// Write back
fs.writeFileSync('clean.html', content, 'utf8');
console.log('File updated successfully!');
