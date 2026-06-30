#!/usr/bin/env node
/**
 * build-css.js — build Tailwind CSS (production) → tailwindcss.html (<style> partial)
 * แทน Play CDN (cdn.tailwindcss.com) ที่ใช้ใน production ไม่ได้
 */
const { execSync } = require('child_process');
const fs = require('fs');

execSync('npx tailwindcss -i tailwind.input.css -o .tw.css --minify', { stdio: 'inherit' });
const css = fs.readFileSync('.tw.css', 'utf8');
fs.writeFileSync('tailwindcss.html', '<style>\n' + css + '\n</style>\n');
fs.unlinkSync('.tw.css');
console.log('✓ tailwindcss.html (' + Math.round(fs.statSync('tailwindcss.html').size / 1024) + 'KB)');
