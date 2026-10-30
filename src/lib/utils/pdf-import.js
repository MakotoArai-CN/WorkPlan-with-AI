// PDF bank statement import.
//
// ICBC's online statement is a text-based PDF with a password. The statement
// repeats a header/footer on every page and prints the date on one line, then
// the time + account + amount columns on the next. The parser below is
// deliberately line-oriented so it also works when pdf.js inserts line breaks.

let pdfjsPromise = null;

async function loadPdfjs() {
    if (!pdfjsPromise) {
        pdfjsPromise = (async () => {
            const [pdfjs, worker] = await Promise.all([
                import('pdfjs-dist/legacy/build/pdf.mjs'),
                import('pdfjs-dist/legacy/build/pdf.worker.mjs?raw')
            ]);
            // A blob URL keeps the worker self-contained and avoids WebView /
            // static-server MIME issues with .mjs worker files.
            const workerUrl = URL.createObjectURL(
                new Blob([worker.default], { type: 'text/javascript' })
            );
            pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
            return pdfjs;
        })();
    }
    return pdfjsPromise;
}

function parseAmount(value) {
    const text = String(value || '').replace(/[,\s]/g, '');
    const amount = Number(text);
    return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

const TRANSACTION_RE = /^(\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s+(\d{4})\s+([+-]?[\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(.+)$/;
const DATE_RE = /^(\d{4}-\d{2}-\d{2})$/;
const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+)$/;

function pushRow(rows, date, timeLine) {
    const match = timeLine.match(TRANSACTION_RE);
    if (!match) return;
    const description = match[7];
    const amountText = match[9];
    const amount = parseAmount(amountText);
    if (amount === null) return;
    rows.push({
        date,
        amount,
        description: description.trim()
    });
}

export function parseIcbcStatementText(rawText) {
    const lines = String(rawText || '')
        .split(/\r?\n/)
        .map(line => line.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
    const rows = [];
    let currentDate = '';
    for (const line of lines) {
        const sameLine = line.match(DATE_TIME_RE);
        if (sameLine) {
            currentDate = sameLine[1];
            pushRow(rows, currentDate, `${sameLine[2]} ${sameLine[3]}`);
            continue;
        }
        const dateOnly = line.match(DATE_RE);
        if (dateOnly) {
            currentDate = dateOnly[1];
            continue;
        }
        if (currentDate && /^\d{2}:\d{2}:\d{2}\s/.test(line)) {
            pushRow(rows, currentDate, line);
        }
    }
    return {
        headers: ['交易日期', '摘要', '交易金额'],
        rows: rows.map(row => [row.date, row.description, String(row.amount)])
    };
}

export async function parsePdfBankStatement(file, password = '') {
    if (!file) throw new Error('PDF_FILE_REQUIRED');
    const pdfjs = await loadPdfjs();
    const buffer = new Uint8Array(await file.arrayBuffer());
    let doc;
    let loadingTask;
    try {
        loadingTask = pdfjs.getDocument({
            data: buffer,
            password: password || undefined,
            isEvalSupported: false,
            useWorkerFetch: false
        });
        doc = await loadingTask.promise;
    } catch (error) {
        if (error?.name === 'PasswordException') throw new Error('PDF_PASSWORD_REQUIRED');
        throw error;
    }
    try {
        const pages = [];
        for (let index = 1; index <= doc.numPages; index += 1) {
            const page = await doc.getPage(index);
            const content = await page.getTextContent();
            let text = '';
            for (const item of content.items) {
                text += item.str + (item.hasEOL ? '\n' : ' ');
            }
            pages.push(text);
        }
        return parseIcbcStatementText(pages.join('\n'));
    } finally {
        if (loadingTask?.destroy) await loadingTask.destroy();
    }
}
