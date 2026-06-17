const fs = require('fs');

// Read the file with UTF-8 encoding
let content = fs.readFileSync('clean.html', 'utf8');

// Carefully replace only text strings that are in quotes, HTML, or comments
// Avoid replacing variable or function names
// We'll look for patterns that are clearly user-facing text

// Replace text that's inside HTML tags or quoted strings
// This is not perfect but should be safe for our use case
content = content.replace(/巡邏/g, '清潔');
content = content.replace(/巡視/g, '檢查');
content = content.replace(/保全/g, '清潔員');

// Make sure we didn't break the community_cleans collection reference
// Restore it if it got changed
content = content.replace(/community_cleans/g, 'community_cleans');
content = content.replace(/community_清潔s/g, 'community_cleans');

// Also fix clean.html reference
content = content.replace(/clean\.html/g, 'clean.html');
content = content.replace(/清潔\.html/g, 'clean.html');

// Write back
fs.writeFileSync('clean.html', content, 'utf8');
console.log('Careful text replacement completed!');
