// CSV helpers for importing salary rows from Chinese bank statements.
// Bank exports differ by bank, so the UI lets the user pick a preset and
// remap the date / amount / description columns instead of relying on one
// hard-coded format.

export const BANK_PRESETS = [
    {
        id: 'icbc',
        name: '工商银行',
        date: ['交易日期', '日期'],
        amount: ['交易金额', '发生额', '金额'],
        income: ['收入金额', '收入'],
        expense: ['支出金额', '支出'],
        description: ['摘要', '交易摘要', '用途', '备注']
    },
    {
        id: 'abc',
        name: '农业银行',
        date: ['交易日期', '日期'],
        amount: ['交易金额', '发生额', '金额'],
        income: ['收入金额', '收入'],
        expense: ['支出金额', '支出'],
        description: ['摘要', '交易说明', '用途', '备注']
    },
    {
        id: 'cmb',
        name: '招商银行',
        date: ['交易日期', '日期'],
        amount: ['收入', '存入金额', '交易金额'],
        income: ['收入', '存入金额'],
        expense: ['支出', '取出金额'],
        description: ['交易类型', '备注', '摘要', '交易说明']
    },
    {
        id: 'ccb',
        name: '建设银行',
        date: ['交易日期', '日期'],
        amount: ['交易金额', '发生额', '金额'],
        income: ['收入金额', '收入'],
        expense: ['支出金额', '支出'],
        description: ['摘要', '备注', '用途']
    },
    {
        id: 'boc',
        name: '中国银行',
        date: ['交易日期', '日期'],
        amount: ['交易金额', '发生额', '金额'],
        income: ['收入金额', '收入'],
        expense: ['支出金额', '支出'],
        description: ['摘要', '交易说明', '备注']
    },
    {
        id: 'generic',
        name: '通用 CSV',
        date: ['日期', '交易日期', 'date'],
        amount: ['金额', '交易金额', 'amount'],
        income: ['收入', 'income'],
        expense: ['支出', 'expense'],
        description: ['摘要', '备注', '说明', 'description']
    }
];

const SALARY_PATTERN = /(工资|薪资|薪金|薪酬|代发|奖金|绩效|工薪)/;

function normalizeHeader(value) {
    return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function findHeaderIndex(headers, aliases = []) {
    const normalized = headers.map(normalizeHeader);
    for (const alias of aliases) {
        const index = normalized.indexOf(normalizeHeader(alias));
        if (index >= 0) return index;
    }
    return -1;
}

export function parseCsv(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const delimiter = source.includes('\t') && !source.includes(',') ? '\t' : ',';
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        if (quoted) {
            if (char === '"') {
                if (source[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    quoted = false;
                }
            } else {
                field += char;
            }
            continue;
        }
        if (char === '"') {
            quoted = true;
        } else if (char === delimiter) {
            row.push(field);
            field = '';
        } else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (char !== '\r') {
            field += char;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    const nonEmpty = rows.filter(cells => cells.some(cell => String(cell).trim()));
    if (!nonEmpty.length) return { headers: [], rows: [], headerIndex: -1 };

    let headerIndex = 0;
    let bestScore = -1;
    for (let i = 0; i < Math.min(nonEmpty.length, 20); i += 1) {
        const line = nonEmpty[i].map(normalizeHeader).join('|');
        let score = 0;
        if (/日期|date/.test(line)) score += 2;
        if (/金额|发生额|收入|支出|amount/.test(line)) score += 2;
        if (/摘要|备注|用途|说明|description/.test(line)) score += 1;
        if (/余额|balance/.test(line)) score += 1;
        if (score > bestScore) {
            bestScore = score;
            headerIndex = i;
        }
    }
    if (bestScore < 3) headerIndex = 0;

    const headers = [];
    const counts = new Map();
    for (const cell of nonEmpty[headerIndex]) {
        const base = String(cell || '').trim() || `列${headers.length + 1}`;
        const count = (counts.get(base) || 0) + 1;
        counts.set(base, count);
        headers.push(count > 1 ? `${base} (${count})` : base);
    }
    return {
        headers,
        rows: nonEmpty.slice(headerIndex + 1),
        headerIndex
    };
}

export function detectPreset(headers) {
    const normalized = headers.map(normalizeHeader);
    let best = { id: 'generic', score: 0 };
    for (const preset of BANK_PRESETS) {
        if (preset.id === 'generic') continue;
        const fields = [...preset.date, ...preset.amount, ...preset.description];
        const score = fields.filter(alias => normalized.includes(normalizeHeader(alias))).length;
        if (score > best.score) best = { id: preset.id, score };
    }
    return best.score >= 2 ? best.id : 'generic';
}

export function suggestMapping(headers, presetId = 'generic') {
    const preset = BANK_PRESETS.find(item => item.id === presetId) || BANK_PRESETS.at(-1);
    return {
        date: findHeaderIndex(headers, preset.date),
        amount: findHeaderIndex(headers, preset.amount),
        income: findHeaderIndex(headers, preset.income),
        expense: findHeaderIndex(headers, preset.expense),
        description: findHeaderIndex(headers, preset.description)
    };
}

function parseAmount(value) {
    let text = String(value ?? '').trim();
    if (!text) return 0;
    const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
    text = text.replace(/[(),￥¥$,\s]/g, '').replace(/[^\d.-]/g, '');
    const amount = Number(text);
    if (!Number.isFinite(amount)) return 0;
    return negative ? -Math.abs(amount) : amount;
}

function normalizeDate(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const digits = text.replace(/\D/g, '');
    if (digits.length === 8) {
        const year = digits.slice(0, 4);
        const month = digits.slice(4, 6);
        const day = digits.slice(6, 8);
        if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
            return `${year}-${month}-${day}`;
        }
    }
    const match = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (match) {
        return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
    return '';
}

function valueAt(row, index) {
    return index >= 0 && index < row.length ? row[index] : '';
}

export function mapTransactions(rows, headers, mapping) {
    return (Array.isArray(rows) ? rows : [])
        .map(row => {
            const date = normalizeDate(valueAt(row, mapping.date));
            let amount = parseAmount(valueAt(row, mapping.amount));
            if (!amount && (mapping.income >= 0 || mapping.expense >= 0)) {
                amount = parseAmount(valueAt(row, mapping.income)) - parseAmount(valueAt(row, mapping.expense));
            }
            const description = [mapping.description, mapping.income, mapping.expense]
                .filter(index => index >= 0)
                .map(index => valueAt(row, index))
                .filter(Boolean)
                .join(' ');
            return { date, amount, description };
        })
        .filter(item => item.date && item.amount !== 0);
}

export function isSalaryDescription(description) {
    return SALARY_PATTERN.test(String(description || ''));
}

export function getSalaryGrowth(actuals = []) {
    const rows = (Array.isArray(actuals) ? actuals : [])
        .filter(item => item && item.periodEnd && Number.isFinite(Number(item.amount)))
        .sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));
    if (!rows.length) {
        return { first: null, latest: null, difference: 0, percent: 0, rows: [] };
    }
    const first = rows[0];
    const latest = rows[rows.length - 1];
    const difference = Math.round((Number(latest.amount) - Number(first.amount)) * 100) / 100;
    const percent = Number(first.amount) > 0
        ? Math.round((difference / Number(first.amount)) * 10000) / 100
        : 0;
    return {
        first,
        latest,
        difference,
        percent,
        rows: rows.map((item, index) => {
            const previous = index > 0 ? Number(rows[index - 1].amount) : null;
            const change = previous === null ? null : Math.round((Number(item.amount) - previous) * 100) / 100;
            const changePercent = previous > 0 ? Math.round((change / previous) * 10000) / 100 : null;
            return { ...item, change, changePercent };
        })
    };
}
