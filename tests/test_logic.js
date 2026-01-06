function mockParseNames(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    return lines.map(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            return {
                name: parts[0].trim(),
                table: parts.slice(1).join('=').trim()
            };
        }
        const altParts = line.split(/[:\t]/);
        if (altParts.length >= 2) {
            return {
                name: altParts[0].trim(),
                table: altParts[1].trim()
            };
        }
        return { name: line.trim(), table: '' };
    }).filter(item => {
        const norm = item.name.toLowerCase().replace(/\s+/g, '');
        return norm !== 'liste' && norm !== '';
    });
}

const testCases = [
    "John Doe = Table 1",
    "Jane Smith=Table 5",
    "Bob Martin : Table 10",
    "Alice Wonderland\tTable 2",
    "Just a Name",
    "Liste",
    "   ",
    "Name = Table = Something"
];

console.log("Testing splitting logic...");
const results = mockParseNames(testCases.join('\n'));
console.table(results);

const success = results.length === 6 &&
    results[0].name === "John Doe" && results[0].table === "Table 1" &&
    results[1].name === "Jane Smith" && results[1].table === "Table 5" &&
    results[2].name === "Bob Martin" && results[2].table === "Table 10" &&
    results[3].name === "Alice Wonderland" && results[3].table === "Table 2" &&
    results[4].name === "Just a Name" && results[4].table === "" &&
    results[5].name === "Name" && results[5].table === "Table = Something";

if (success) {
    console.log("\n✅ All tests passed!");
} else {
    console.error("\n❌ Some tests failed!");
    process.exit(1);
}
