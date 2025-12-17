import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import markedKatex from 'marked-katex-extension';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import DOMPurify from 'dompurify';

let mermaidModule = null;
let mermaidInitialized = false;

function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

async function initMermaid() {
    if (mermaidInitialized) return;
    if (typeof window === 'undefined') return;
    try {
        mermaidModule = await import('mermaid');
        mermaidModule.default.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'loose',
            fontSize: 14,
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis'
            }
        });
        mermaidInitialized = true;
    } catch (e) {
        console.warn('Mermaid not available:', e);
    }
}

if (typeof window !== 'undefined') {
    initMermaid();
}

marked.use(markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
        if (lang === 'mermaid') {
            return code;
        }
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        try {
            return hljs.highlight(code, { language }).value;
        } catch {
            return hljs.highlightAuto(code).value;
        }
    }
}));

marked.use(markedKatex({
    throwOnError: false,
    output: 'html',
    displayMode: false,
    strict: false,
    trust: true,
    macros: {
        "\\RR": "\\mathbb{R}",
        "\\NN": "\\mathbb{N}",
        "\\ZZ": "\\mathbb{Z}",
        "\\QQ": "\\mathbb{Q}"
    }
}));

marked.use(gfmHeadingId({
    prefix: 'heading-'
}));

marked.setOptions({
    breaks: true,
    gfm: true,
    pedantic: false,
    smartLists: true,
    smartypants: true
});

function extractCodeFromRaw(raw, lang) {
    if (!raw) return '';
    const regex = new RegExp('^```' + lang + '\\s*\\n([\\s\\S]*?)\\n```$', 'm');
    const match = raw.match(regex);
    if (match && match[1]) {
        return match[1];
    }
    const lines = raw.split('\n');
    if (lines.length >= 2) {
        return lines.slice(1, -1).join('\n');
    }
    return raw;
}

const renderer = {
    listitem(token) {
        const text = token.text || '';
        if (/^\s*\[[ xX]\]/.test(text)) {
            const checked = /^\s*\[[xX]\]/.test(text);
            const content = text.replace(/^\s*\[[ xX]\]\s*/, '');
            return `<li class="task-list-item"><input type="checkbox" ${checked ? 'checked' : ''} disabled><span>${content}</span></li>`;
        }
        return false;
    },
    
    code(token) {
        const lang = token.lang || '';
        
        if (lang === 'mermaid') {
            const code = extractCodeFromRaw(token.raw, 'mermaid');
            const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
            
            if (typeof window !== 'undefined') {
                setTimeout(async () => {
                    if (!mermaidInitialized) {
                        await initMermaid();
                    }
                    
                    if (!mermaidModule) {
                        const element = document.getElementById('mermaid-placeholder-' + id);
                        if (element) {
                            element.innerHTML = `<pre><code>${escapeHtml(code)}</code></pre><p class="error-msg">Mermaid 未加载</p>`;
                            element.classList.add('mermaid-error');
                        }
                        return;
                    }
                    
                    try {
                        const element = document.getElementById('mermaid-placeholder-' + id);
                        if (element) {
                            const result = await mermaidModule.default.render('svg-' + id, code);
                            element.innerHTML = result.svg;
                            element.classList.remove('mermaid-placeholder');
                            element.classList.add('mermaid-container');
                        }
                    } catch (e) {
                        const element = document.getElementById('mermaid-placeholder-' + id);
                        if (element) {
                            element.innerHTML = `<pre><code>${escapeHtml(code)}</code></pre><p class="error-msg">Mermaid 渲染错误: ${e.message}</p>`;
                            element.classList.add('mermaid-error');
                        }
                    }
                }, 100);
            }
            
            return `<div id="mermaid-placeholder-${id}" class="mermaid-placeholder"><div class="mermaid-loading"><i class="ph ph-spinner animate-spin"></i> 正在渲染图表...</div></div>`;
        }
        
        return false;
    },
    
    table(token) {
        if (!token) return '';
        
        let headerHtml = '<tr>';
        if (token.header && Array.isArray(token.header)) {
            for (const cell of token.header) {
                const cellText = this.parser ? this.parser.parseInline(cell.tokens) : (cell.text || '');
                const align = cell.align ? ` style="text-align: ${cell.align}"` : '';
                headerHtml += `<th${align}>${cellText}</th>`;
            }
        }
        headerHtml += '</tr>';
        
        let bodyHtml = '';
        if (token.rows && Array.isArray(token.rows)) {
            for (const row of token.rows) {
                bodyHtml += '<tr>';
                for (const cell of row) {
                    const cellText = this.parser ? this.parser.parseInline(cell.tokens) : (cell.text || '');
                    const align = cell.align ? ` style="text-align: ${cell.align}"` : '';
                    bodyHtml += `<td${align}>${cellText}</td>`;
                }
                bodyHtml += '</tr>';
            }
        }
        
        return `<div class="table-wrapper"><table><thead>${headerHtml}</thead><tbody>${bodyHtml}</tbody></table></div>`;
    },
    
    blockquote(token) {
        const text = token.text || '';
        const alertMatch = text.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
        if (alertMatch) {
            const type = alertMatch[1].toLowerCase();
            const content = text.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '');
            const icons = {
                note: 'ph-info',
                tip: 'ph-lightbulb',
                important: 'ph-warning',
                warning: 'ph-warning-circle',
                caution: 'ph-shield-warning'
            };
            return `<div class="alert alert-${type}">
                <i class="ph ${icons[type]}"></i>
                <div class="alert-content">${content}</div>
            </div>`;
        }
        return false;
    },
    
    link(token) {
        const href = token.href || '';
        const title = token.title || '';
        const text = token.text || '';
        const isExternal = href && (href.startsWith('http://') || href.startsWith('https://'));
        const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(href)}"${target}${titleAttr}>${text}</a>`;
    }
};

marked.use({ renderer });

export function renderMarkdown(text) {
    if (!text) return '';
    try {
        const html = marked.parse(text);
        return DOMPurify.sanitize(html, {
            ADD_ATTR: ['target', 'rel', 'class', 'disabled', 'checked', 'type', 'id', 'style'],
            ADD_TAGS: ['iframe', 'input', 'svg', 'g', 'path', 'rect', 'circle', 'text', 'line', 'polygon', 'polyline', 'foreignObject'],
            ALLOW_DATA_ATTR: true
        });
    } catch (e) {
        console.error('Markdown parse error:', e);
        return DOMPurify.sanitize(escapeHtml(text));
    }
}

export function isMarkdown(text) {
    if (!text || typeof text !== 'string') return false;
    const markdownPatterns = [
        /^#{1,6}\s/m,
        /\*\*[^*]+\*\*/,
        /\*[^*]+\*/,
        /`[^`]+`/,
        /```[\s\S]*?```/,
        /^\s*[-*+]\s/m,
        /^\s*\d+\.\s/m,
        /\[.+\]\(.+\)/,
        /^\s*>/m,
        /\|.+\|/,
        /^---+$/m,
        /^===+$/m,
        /\$\$.+\$\$/,
        /\$.+\$/,
        /~~.+~~/,
        /^\s*\[[ xX]\]/m
    ];
    return markdownPatterns.some(pattern => pattern.test(text));
}

export { escapeHtml };