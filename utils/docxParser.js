import mammoth from 'mammoth';

/**
 * Parses names from a DOCX file and splits them by '='.
 * If a line contains '=', everything before is 'name' and everything after is 'table'.
 * If no '=' is present, the entire line is 'name' and 'table' is empty.
 * @param {string} filePath - Path to the DOCX file.
 * @returns {Promise<Array<{name: string, table: string}>>}
 */
export async function parseDocxNames(filePath) {
    try {
        const { value } = await mammoth.extractRawText({ path: filePath });
        const text = value || '';

        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');

        return lines.map(line => {
            const parts = line.split('=');
            if (parts.length >= 2) {
                return {
                    name: parts[0].trim(),
                    table: parts.slice(1).join('=').trim()
                };
            }
            return {
                name: line.trim(),
                table: ''
            };
        }).filter(item => {
            const norm = item.name.toLowerCase().replace(/\s+/g, '');
            return norm !== 'liste' && norm !== '';
        });
    } catch (error) {
        console.error('Error parsing DOCX:', error);
        return [];
    }
}
