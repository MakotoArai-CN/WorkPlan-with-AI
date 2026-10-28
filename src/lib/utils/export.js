import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import CryptoJS from 'crypto-js';
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from './runtime.js';
import { stripDataUrlPrefix, describeSavedLocation } from './export-payload.js';
import { convertOklchColorsInValue } from './color.js';

// Components format their save toasts with this, and reach it through the export
// module they already import.
export { describeSavedLocation };

function sanitizeDownloadFilename(filename = 'export') {
    const value = String(filename || 'export').trim();
    const lastDot = value.lastIndexOf('.');
    const hasExtension = lastDot > 0 && lastDot < value.length - 1;
    const basename = hasExtension ? value.slice(0, lastDot) : value;
    const extension = hasExtension ? value.slice(lastDot) : '';

    const cleanBase = basename
        .replace(/[<>:"/\\|?*\u0000-\u001F：／＼？＊｜]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 120) || 'export';

    const cleanExtension = extension
        .replace(/[^.\w-]/g, '')
        .slice(0, 16);

    return `${cleanBase}${cleanExtension}`;
}

function isUserCancel(error) {
    const message = String(error?.message ?? error ?? '');
    return message.includes('CANCELLED:') || message.includes('用户取消了保存');
}

function withLocation(message, result) {
    const location = describeSavedLocation(result?.path);
    return location ? `${message}（${location}）` : message;
}

/**
 * Platform-aware file download helper.
 * Prefers Tauri backend (save_file_via_dialog / save_file_to_downloads).
 * Falls back to browser <a download>.click() for pure web environments.
 * @returns {{ success: boolean, path?: string, cancelled?: boolean }}
 */
async function downloadFile(rawContent, filename, options = {}) {
    const {
        useSaveDialog = false,
        filters = [],
        base64 = false
    } = options;
    const safeFilename = sanitizeDownloadFilename(filename);
    const content = base64 ? stripDataUrlPrefix(rawContent) : rawContent;

    if (isTauriRuntime) {
        if (useSaveDialog) {
            try {
                const savedPath = await invoke('save_file_via_dialog', {
                    filename: safeFilename,
                    content,
                    filters,
                    base64
                });
                if (savedPath) {
                    return { success: true, path: savedPath };
                }
            } catch (e) {
                if (isUserCancel(e)) {
                    return { success: false, cancelled: true };
                }
                console.warn('save_file_via_dialog failed, writing to the downloads directory:', e);
            }
        }

        // Let this one throw: on Android the browser fallback below cannot write
        // anything, so swallowing the error is what produced "export succeeded"
        // toasts for files that were never created.
        const savedPath = await invoke('save_file_to_downloads', {
            filename: safeFilename,
            content,
            base64
        });
        return { success: true, path: savedPath };
    }

    // Fallback: browser-based download
    const blob = base64
        ? await (await fetch(`data:application/octet-stream;base64,${content}`)).blob()
        : new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFilename;
    a.click();
    URL.revokeObjectURL(url);
    return { success: true };
}

function cleanOklchColors(element) {
    const clone = element.cloneNode(true);
    const originals = [element, ...element.querySelectorAll('*')];
    const clones = [clone, ...clone.querySelectorAll('*')];
    const properties = [
        'color',
        'background-color',
        'background-image',
        'border-color',
        'border-top-color',
        'border-right-color',
        'border-bottom-color',
        'border-left-color',
        'outline-color',
        'text-decoration-color',
        'fill',
        'stroke'
    ];

    for (let index = 0; index < originals.length; index += 1) {
        const source = originals[index];
        const target = clones[index];
        if (!target?.style) continue;
        const computedStyle = window.getComputedStyle(source);
        for (const property of properties) {
            const value = computedStyle.getPropertyValue(property);
            const converted = convertOklchColorsInValue(value);
            if (converted !== value) {
                target.style.setProperty(property, converted);
            }
        }
    }
    return clone;
}

export async function exportToPDF(element, filename = 'export.pdf', options = {}) {
    const { width = 'a4', showToast } = options;

    try {
        if (showToast) showToast({ message: '正在生成PDF...', type: 'info', duration: 2000 });

        const cleanedElement = cleanOklchColors(element);

        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            position: absolute;
            left: -9999px;
            top: 0;
            width: ${width === 'a4' ? '794px' : 'auto'};
            padding: 40px;
            background: #ffffff;
            box-sizing: border-box;
        `;
        wrapper.appendChild(cleanedElement);
        document.body.appendChild(wrapper);

        const canvas = await html2canvas(wrapper, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            width: width === 'a4' ? 794 : undefined,
            windowWidth: width === 'a4' ? 794 : undefined
        });

        document.body.removeChild(wrapper);

        const imgData = canvas.toDataURL('image/png');

        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const contentWidth = pageWidth - 2 * margin;
        const contentHeight = (canvas.height / canvas.width) * contentWidth;

        if (contentHeight <= pageHeight - 2 * margin) {
            pdf.addImage(imgData, 'PNG', margin, margin, contentWidth, contentHeight);
        } else {
            const pageContentHeight = pageHeight - 2 * margin;
            const totalPages = Math.ceil(contentHeight / pageContentHeight);

            for (let i = 0; i < totalPages; i++) {
                if (i > 0) {
                    pdf.addPage();
                }

                const sourceY = (i * pageContentHeight / contentHeight) * canvas.height;
                const sourceHeight = Math.min(
                    (pageContentHeight / contentHeight) * canvas.height,
                    canvas.height - sourceY
                );

                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = canvas.width;
                pageCanvas.height = sourceHeight;
                const ctx = pageCanvas.getContext('2d');
                ctx.drawImage(
                    canvas,
                    0, sourceY, canvas.width, sourceHeight,
                    0, 0, canvas.width, sourceHeight
                );

                const pageImgData = pageCanvas.toDataURL('image/png');
                const drawHeight = (sourceHeight / canvas.width) * contentWidth;
                pdf.addImage(pageImgData, 'PNG', margin, margin, contentWidth, drawHeight);
            }
        }

        // jsPDF.save() drops a blob download, which silently no-ops in the Android
        // WebView. Route the bytes through the same save path as every other export.
        const pdfFilename = sanitizeDownloadFilename(filename);
        const result = await downloadFile(pdf.output('datauristring'), pdfFilename, {
            useSaveDialog: isTauriRuntime,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
            base64: true
        });

        if (result.cancelled) {
            if (showToast) showToast({ message: '已取消导出', type: 'info' });
            return result;
        }

        if (showToast) showToast({ message: withLocation('PDF导出成功', result), type: 'success', duration: 6000 });
        return result;
    } catch (e) {
        console.error('PDF export failed:', e);
        if (showToast) showToast({ message: 'PDF导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

export async function exportToMarkdown(content, filename = 'export.md', options = {}) {
    const { showToast } = options;

    try {
        if (showToast) showToast({ message: '正在导出Markdown...', type: 'info', duration: 1500 });

        const result = await downloadFile(content, filename, {
            useSaveDialog: isTauriRuntime,
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
        });

        if (result.cancelled) {
            if (showToast) showToast({ message: '已取消导出', type: 'info' });
            return result;
        }

        if (showToast) showToast({ message: withLocation('Markdown导出成功', result), type: 'success', duration: 6000 });
        return result;
    } catch (e) {
        console.error('Markdown export failed:', e);
        if (showToast) showToast({ message: 'Markdown导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

export async function exportToHTML(content, filename = 'export.html', title = 'Export', options = {}) {
    const { showToast } = options;

    try {
        if (showToast) showToast({ message: '正在导出HTML...', type: 'info', duration: 1500 });

        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
        pre { background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; }
        code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f4f4f4; }
        blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 16px; color: #666; }
    </style>
</head>
<body>${content}</body>
</html>`;
        const result = await downloadFile(html, filename, {
            useSaveDialog: isTauriRuntime,
            filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
        });

        if (result.cancelled) {
            if (showToast) showToast({ message: '已取消导出', type: 'info' });
            return result;
        }

        if (showToast) showToast({ message: withLocation('HTML导出成功', result), type: 'success', duration: 6000 });
        return result;
    } catch (e) {
        console.error('HTML export failed:', e);
        if (showToast) showToast({ message: 'HTML导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

export async function exportToCSV(data, filename = 'export.csv', options = {}) {
    const { showToast } = options;

    try {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('没有数据可导出');
        }

        if (showToast) showToast({ message: '正在导出CSV...', type: 'info', duration: 1500 });

        const headers = [];
        const seen = new Set();
        for (const row of data) {
            for (const key of Object.keys(row || {})) {
                if (!seen.has(key)) {
                    seen.add(key);
                    headers.push(key);
                }
            }
        }

        const escapeCsvValue = (value) => {
            if (typeof value === 'string') {
                // Neutralize spreadsheet formulas (=cmd|..., +..., -..., @...).
                const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
                return `"${guarded.replace(/"/g, '""')}"`;
            }
            return `"${String(value ?? '').replace(/"/g, '""')}"`;
        };

        const csvContent = [
            headers.join(','),
            ...data.map(row => headers.map(header => escapeCsvValue(row?.[header])).join(','))
        ].join('\n');

        const BOM = '\uFEFF';
        const result = await downloadFile(BOM + csvContent, filename, {
            useSaveDialog: isTauriRuntime,
            filters: [{ name: 'CSV', extensions: ['csv'] }]
        });

        if (result.cancelled) {
            if (showToast) showToast({ message: '已取消导出', type: 'info' });
            return result;
        }

        if (showToast) showToast({ message: withLocation('CSV导出成功', result), type: 'success', duration: 6000 });
        return result;
    } catch (e) {
        console.error('CSV export failed:', e);
        if (showToast) showToast({ message: 'CSV导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

export async function exportToEncryptedJSON(data, filename = 'export.json', password = '', options = {}) {
    const { showToast } = options;

    try {
        if (showToast) showToast({ message: '正在导出加密数据...', type: 'info', duration: 1500 });

        let content;
        if (password) {
            const jsonStr = JSON.stringify(data);
            const encrypted = CryptoJS.AES.encrypt(jsonStr, password).toString();
            content = JSON.stringify({
                encrypted: true,
                data: encrypted,
                hint: '使用导出时设置的密码解密',
                exportTime: new Date().toISOString()
            }, null, 2);
        } else {
            content = JSON.stringify(data, null, 2);
        }

        const result = await downloadFile(content, filename, {
            useSaveDialog: isTauriRuntime,
            filters: [{ name: 'JSON', extensions: ['json'] }]
        });

        if (result.cancelled) {
            if (showToast) showToast({ message: '已取消导出', type: 'info' });
            return result;
        }

        if (showToast) showToast({ message: withLocation('数据导出成功' + (password ? '（已加密）' : ''), result), type: 'success', duration: 6000 });
        return result;
    } catch (e) {
        console.error('JSON export failed:', e);
        if (showToast) showToast({ message: '导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

export async function exportToJSON(data, filename = 'export.json', options = {}) {
    const { showToast } = options;

    try {
        if (showToast) showToast({ message: '正在导出数据...', type: 'info', duration: 1500 });

        const content = JSON.stringify(data, null, 2);
        const result = await downloadFile(content, filename, {
            useSaveDialog: isTauriRuntime,
            filters: [{ name: 'JSON', extensions: ['json'] }]
        });

        if (result.cancelled) {
            if (showToast) showToast({ message: '已取消导出', type: 'info' });
            return result;
        }

        if (showToast) showToast({ message: withLocation('数据导出成功', result), type: 'success', duration: 6000 });
        return result;
    } catch (e) {
        console.error('JSON export failed:', e);
        if (showToast) showToast({ message: '导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

/** Export Markdown notes to a real .docx workbook. */
export async function exportNotesToWord(notes, filename = 'notes.docx', options = {}) {
    const { showToast } = options;
    try {
        const list = Array.isArray(notes) ? notes.filter(note => note && note.title !== undefined) : [];
        if (list.length === 0) throw new Error('没有可导出的笔记');

        if (showToast) showToast({ message: '正在生成 Word...', type: 'info', duration: 1500 });

        const docx = await import('docx');
        const {
            AlignmentType,
            Document,
            HeadingLevel,
            Packer,
            Paragraph,
            TextRun
        } = docx.default || docx;

        const cleanInline = (text) => String(text || '')
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/[*_~`>#]+/g, '')
            .trim();

        const children = [];
        for (let index = 0; index < list.length; index += 1) {
            const note = list[index];
            children.push(new Paragraph({
                text: String(note.title || '未命名笔记'),
                heading: HeadingLevel.HEADING_1,
                spacing: { before: index === 0 ? 0 : 320, after: 120 }
            }));
            const meta = [note.category, note.updatedAt ? new Date(note.updatedAt).toLocaleString() : '']
                .filter(Boolean)
                .join(' · ');
            if (meta) {
                children.push(new Paragraph({
                    children: [new TextRun({ text: meta, italics: true, size: 18, color: '888888' })],
                    spacing: { after: 160 }
                }));
            }

            const lines = String(note.content || '').split(/\r?\n/);
            for (const rawLine of lines) {
                const line = rawLine.trimEnd();
                if (!line.trim()) {
                    children.push(new Paragraph({ text: '' }));
                    continue;
                }
                const heading = line.match(/^(#{1,3})\s+(.*)$/);
                if (heading) {
                    children.push(new Paragraph({
                        text: cleanInline(heading[2]),
                        heading: heading[1].length === 1
                            ? HeadingLevel.HEADING_1
                            : heading[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
                        spacing: { before: 200, after: 80 }
                    }));
                    continue;
                }
                const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
                if (bullet) {
                    children.push(new Paragraph({
                        children: [new TextRun({ text: cleanInline(bullet[1]) })],
                        bullet: { level: 0 },
                        spacing: { after: 40 }
                    }));
                    continue;
                }
                if (/^\s*```/.test(line)) continue;
                children.push(new Paragraph({
                    children: [new TextRun({ text: cleanInline(line), size: 22 })],
                    spacing: { after: 60 },
                    alignment: AlignmentType.LEFT
                }));
            }
        }

        const document = new Document({
            creator: 'WorkPlan',
            title: 'WorkPlan Notes',
            sections: [{ properties: {}, children }]
        });
        const base64 = await Packer.toBase64String(document);
        const result = await downloadFile(base64, filename, {
            useSaveDialog: isTauriRuntime,
            filters: [{ name: 'Word', extensions: ['docx'] }],
            base64: true
        });
        if (result.cancelled) {
            if (showToast) showToast({ message: '已取消导出', type: 'info' });
            return result;
        }
        if (showToast) showToast({ message: withLocation('Word 导出成功', result), type: 'success', duration: 6000 });
        return result;
    } catch (error) {
        console.error('Word export failed:', error);
        if (showToast) showToast({ message: 'Word 导出失败: ' + error.message, type: 'error' });
        return { success: false, error: error.message };
    }
}

/**
 * Export rows to a real Excel workbook (.xlsx) via ExcelJS.
 * The module is loaded lazily so it only costs bundle time when used.
 */
export async function exportToExcel(data, filename = 'export.xlsx', options = {}) {
    const exportFont = 'Segoe UI';
    const exportFontSize = 11;
    const { showToast, sheetName = 'Sheet1' } = options;

    try {
        const rows = Array.isArray(data) ? data.filter(row => row && typeof row === 'object') : [];
        if (rows.length === 0) {
            throw new Error('没有数据可导出');
        }

        if (showToast) showToast({ message: '正在导出 Excel...', type: 'info', duration: 1500 });

        const ExcelModule = await import('exceljs');
        const ExcelJS = ExcelModule.default || ExcelModule;
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'WorkPlan';
        workbook.created = new Date();
        const worksheet = workbook.addWorksheet(String(sheetName).slice(0, 31) || 'Sheet1');

        const headers = [];
        const seen = new Set();
        for (const row of rows) {
            for (const key of Object.keys(row)) {
                if (seen.has(key)) continue;
                seen.add(key);
                headers.push(key);
            }
        }

        worksheet.columns = headers.map(header => ({
            header,
            key: header,
            width: Math.min(42, Math.max(12, String(header).length * 2 + 4))
        }));
        for (const row of rows) {
            worksheet.addRow(headers.map(header => row[header] ?? ''));
        }

        const headerRow = worksheet.getRow(1);
        headerRow.font = { name: exportFont, size: exportFontSize, bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 22;
        worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        worksheet.properties.defaultRowHeight = 20;
        worksheet.eachRow((row, rowNumber) => {
            row.height = rowNumber === 1 ? 22 : 20;
            row.eachCell(cell => {
                cell.font = {
                    name: exportFont,
                    size: exportFontSize,
                    bold: rowNumber === 1,
                    color: rowNumber === 1 ? { argb: 'FFFFFFFF' } : undefined
                };
                cell.alignment = { vertical: 'middle', horizontal: rowNumber === 1 ? 'center' : 'left', wrapText: true };
                if (typeof cell.value === 'number') cell.numFmt = '#,##0.00';
            });
        });
        if (headers.length > 0) {
            worksheet.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: headers.length }
            };
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const result = await downloadFile(arrayBufferToBase64(buffer), filename, {
            useSaveDialog: isTauriRuntime,
            filters: [{ name: 'Excel', extensions: ['xlsx'] }],
            base64: true
        });

        if (result.cancelled) {
            if (showToast) showToast({ message: '已取消导出', type: 'info' });
            return result;
        }

        if (showToast) showToast({ message: withLocation('Excel 导出成功', result), type: 'success', duration: 6000 });
        return result;
    } catch (e) {
        console.error('Excel export failed:', e);
        if (showToast) showToast({ message: 'Excel 导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}
