const fs = require('fs');

const files = process.argv.slice(2);
let changed = 0;

for (const filepath of files) {
    if (!fs.existsSync(filepath)) continue;
    let content = fs.readFileSync(filepath, 'utf8');
    let original = content;

    content = content.replace(/\bAUKER\b/g, 'SEN');
    content = content.replace(/\bAuker/g, 'Sen');
    content = content.replace(/\bauker/g, 'sen');
    
    if (content !== original) {
        fs.writeFileSync(filepath, content, 'utf8');
        changed++;
    }
}
console.log(`Updated ${changed} files.`);
