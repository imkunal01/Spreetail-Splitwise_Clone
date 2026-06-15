const fs = require('fs');
const path = require('path');
const srcDir = 'c:/Users/Kunal/Desktop/Projects/Splitwise/Client/src';

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const full = path.join(dir, file);
        if (fs.statSync(full).isDirectory()) { 
            results = results.concat(walk(full));
        } else if (full.endsWith('.jsx')) {
            results.push(full);
        }
    });
    return results;
}

const files = walk(srcDir);

const map = {
    'bg-gray-950': 'bg-slate-50',
    'bg-gray-900': 'bg-white',
    'bg-gray-800': 'bg-slate-50',
    'bg-gray-700': 'bg-slate-100',
    'border-gray-800': 'border-slate-200',
    'border-gray-700': 'border-slate-200',
    'border-gray-600': 'border-slate-300',
    'text-gray-400': 'text-slate-500',
    'text-gray-300': 'text-slate-600',
    'text-gray-200': 'text-slate-700',
    'text-gray-500': 'text-slate-400'
};

files.forEach(f => {
    let content = fs.readFileSync(f, 'utf8');
    
    // Replace standard gray classes
    for (const [dark, light] of Object.entries(map)) {
        const regex = new RegExp('(?<![a-zA-Z0-9-])' + dark + '(?![a-zA-Z0-9-])', 'g');
        content = content.replace(regex, light);
    }
    
    // Replace text-white ONLY if the class string does NOT contain a dark background color like bg-indigo-600, bg-emerald-600, bg-rose-600, bg-red-600, bg-blue-600
    // Actually, text-white is used heavily for headings.
    // A safer regex: find classNames, check if they have bg-[color]-(500|600|700). If NOT, replace text-white with text-slate-900.
    content = content.replace(/className=(['"])(.*?)\1|className=\{`([^`]+)`\}/g, (match, q, simpleClasses, templateClasses) => {
        let classes = simpleClasses || templateClasses;
        let isTemplate = !!templateClasses;
        
        // Does it have a primary/solid background?
        const hasSolidBg = /bg-(indigo|emerald|rose|red|blue|purple|green|yellow|black)-(500|600|700|800|900)/.test(classes);
        const hasTextWhiteIgnore = /text-white/.test(classes) && hasSolidBg;
        
        if (!hasSolidBg) {
            classes = classes.replace(/(?<![a-zA-Z0-9-])text-white(?![a-zA-Z0-9-])/g, 'text-slate-900');
        }
        
        if (isTemplate) return 'className={`' + classes + '`}';
        return 'className=' + q + classes + q;
    });

    // Gradients: from-gray-950 via-gray-900 to-indigo-950
    content = content.replace(/from-gray-950/g, 'from-slate-50');
    content = content.replace(/via-gray-900/g, 'via-white');
    content = content.replace(/to-indigo-950/g, 'to-slate-100');
    
    // bg-gray-900/60 -> bg-white/60
    content = content.replace(/bg-gray-900\/(\d+)/g, 'bg-white/50');
    content = content.replace(/bg-gray-800\/(\d+)/g, 'bg-white/80');
    content = content.replace(/bg-gray-700\/(\d+)/g, 'bg-slate-100/80');
    content = content.replace(/border-gray-700\/(\d+)/g, 'border-slate-300/60');
    
    fs.writeFileSync(f, content, 'utf8');
});
console.log('Done mapping dark mode to light mode classes.');
