import path from 'path';
import fs from 'fs';
import { parseDocxNames } from '../utils/docxParser.js';

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: node backend/scripts/split_names.js <path_to_docx>');
        process.exit(1);
    }

    const filePath = path.resolve(args[0]);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    console.log(`Processing file: ${filePath}...`);
    const names = await parseDocxNames(filePath);

    if (names.length === 0) {
        console.log('No names found or error occurred.');
    } else {
        console.log('\nResults:');
        console.log('---------------------------------------------');
        console.table(names);
        console.log('---------------------------------------------');
        console.log(`Total: ${names.length} entries.`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
