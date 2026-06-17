const fs = require('fs');

// Read the file with UTF-8 encoding
let content = fs.readFileSync('clean.html', 'utf8');

// Only replace user-facing text, NOT variable/function names
// First replace text in quotes and HTML
content = content.replace(/巡邏點/g, '清潔點');
content = content.replace(/開始巡邏/g, '開始清潔');
content = content.replace(/巡邏次數/g, '清潔次數');
content = content.replace(/巡邏紀錄/g, '清潔紀錄');
content = content.replace(/巡邏打卡/g, '清潔打卡');
content = content.replace(/預覽巡邏/g, '預覽清潔');
content = content.replace(/下載巡邏/g, '下載清潔');
content = content.replace(/編輯巡邏/g, '編輯清潔');
content = content.replace(/清除此日期的巡邏/g, '清除此日期的清潔');
content = content.replace(/此日期沒有巡邏/g, '此日期沒有清潔');
content = content.replace(/確認刪除這筆巡邏/g, '確認刪除這筆清潔');
content = content.replace(/巡邏成功/g, '清潔成功');
content = content.replace(/今日已巡邏/g, '今日已清潔');
content = content.replace(/確定要刪除該代碼的巡邏/g, '確定要刪除該代碼的清潔');
content = content.replace(/巡邏點確認/g, '清潔點確認');
content = content.replace(/清潔系統巡邏點/g, '清潔系統清潔點');
content = content.replace(/此次巡視/g, '此次檢查');
content = content.replace(/巡視項目/g, '檢查項目');
content = content.replace(/巡視設定/g, '檢查設定');
content = content.replace(/已巡邏/g, '已清潔');
content = content.replace(/巡邏/g, '清潔');
content = content.replace(/巡視/g, '檢查');
content = content.replace(/保全/g, '清潔員');

// Also update the buildShareUrl function
content = content.replace(/base.pathname = base.pathname.endsWith\(\/\/\) \? \`\$\{base.pathname\}patrol.html\` : base.pathname;/g, 'base.pathname = base.pathname.endsWith(\'/\') ? `${base.pathname}clean.html` : base.pathname;');

// Write back
fs.writeFileSync('clean.html', content, 'utf8');
console.log('Text replacement completed successfully!');
