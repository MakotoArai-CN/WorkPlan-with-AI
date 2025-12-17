import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import CryptoJS from 'crypto-js';

function cleanOklchColors(element) {
    const clone = element.cloneNode(true);
    const allElements = [clone, ...clone.querySelectorAll('*')];
    allElements.forEach(el => {
        const computedStyle = window.getComputedStyle(el);
        const inlineStyle = el.style;
        ['color', 'backgroundColor', 'borderColor', 'fill', 'stroke'].forEach(prop => {
            const value = computedStyle.getPropertyValue(prop);
            if (value && value.includes('oklch')) {
                const rgb = computedStyle.getPropertyValue(prop);
                if (rgb) {
                    inlineStyle.setProperty(prop, rgb);
                }
            }
        });
    });
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
        
        pdf.save(filename);
        
        if (showToast) showToast({ message: 'PDF导出成功', type: 'success' });
        return { success: true };
    } catch (e) {
        console.error('PDF export failed:', e);
        if (showToast) showToast({ message: 'PDF导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

export function exportToMarkdown(content, filename = 'export.md', options = {}) {
    const { showToast } = options;
    
    try {
        if (showToast) showToast({ message: '正在导出Markdown...', type: 'info', duration: 1500 });
        
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        if (showToast) showToast({ message: 'Markdown导出成功', type: 'success' });
        return { success: true };
    } catch (e) {
        console.error('Markdown export failed:', e);
        if (showToast) showToast({ message: 'Markdown导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

export function exportToHTML(content, filename = 'export.html', title = 'Export', options = {}) {
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
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        if (showToast) showToast({ message: 'HTML导出成功', type: 'success' });
        return { success: true };
    } catch (e) {
        console.error('HTML export failed:', e);
        if (showToast) showToast({ message: 'HTML导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

export function exportToCSV(data, filename = 'export.csv', options = {}) {
    const { showToast } = options;
    
    try {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('没有数据可导出');
        }
        
        if (showToast) showToast({ message: '正在导出CSV...', type: 'info', duration: 1500 });
        
        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => 
                headers.map(header => {
                    const value = row[header] ?? '';
                    const escaped = String(value).replace(/"/g, '""');
                    return `"${escaped}"`;
                }).join(',')
            )
        ].join('\n');
        
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        if (showToast) showToast({ message: 'CSV导出成功', type: 'success' });
        return { success: true };
    } catch (e) {
        console.error('CSV export failed:', e);
        if (showToast) showToast({ message: 'CSV导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

export function exportToEncryptedJSON(data, filename = 'export.json', password = '', options = {}) {
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
        
        const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        if (showToast) showToast({ message: '数据导出成功' + (password ? '（已加密）' : ''), type: 'success' });
        return { success: true };
    } catch (e) {
        console.error('JSON export failed:', e);
        if (showToast) showToast({ message: '导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}

export function exportToJSON(data, filename = 'export.json', options = {}) {
    const { showToast } = options;
    
    try {
        if (showToast) showToast({ message: '正在导出数据...', type: 'info', duration: 1500 });
        
        const content = JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        if (showToast) showToast({ message: '数据导出成功', type: 'success' });
        return { success: true };
    } catch (e) {
        console.error('JSON export failed:', e);
        if (showToast) showToast({ message: '导出失败: ' + e.message, type: 'error' });
        return { success: false, error: e.message };
    }
}