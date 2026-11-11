import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import markedKatex from 'marked-katex-extension';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import { sanitizeHtml, sanitizeDiagramSvg } from './safe-html.js';
import { escapeHtml, safeLinkUrl, safeImageUrl } from './safe-content.js';

let mermaidModule = null;
let mermaidInitialized = false;

async function initMermaid() {
    if (mermaidInitialized) return;
    if (typeof window === 'undefined') return;
    try {
        mermaidModule = await import('mermaid');
        mermaidModule.default.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'strict',
            secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'themeCSS', 'flowchart', 'htmlLabels', 'dompurifyConfig'],
            themeCSS: '',
            suppressErrorRendering: true,
            maxTextSize: 50000,
            maxEdges: 1000,
            fontSize: 14,
            flowchart: {
                useMaxWidth: true,
                htmlLabels: false,
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
    trust: false,
    maxSize: 20,
    maxExpand: 1000,
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

function sanitizeLinkHref(href) {
    return escapeHtml(safeLinkUrl(href) || '#');
}

function diagramPlaceholder(id) {
    return document.getElementById('user-content-mermaid-placeholder-' + id);
}

const renderer = {
    html(token) {
        // AI/cloud markdown is content, never application HTML or CSS.
        return escapeHtml(token.text || token.raw || '');
    },
    listitem(token) {
        const text = token.text || '';
        if (/^\s*\[[ xX]\]/.test(text)) {
            const checked = /^\s*\[[xX]\]/.test(text);
            const content = marked.parseInline(text.replace(/^\s*\[[ xX]\]\s*/, ''));
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
                        const element = diagramPlaceholder(id);
                        if (element) {
                            element.innerHTML = sanitizeHtml(
                                `<pre><code>${escapeHtml(code)}</code></pre><p class="error-msg">Mermaid 未加载</p>`
                            );
                            element.classList.add('mermaid-error');
                        }
                        return;
                    }
                    
                    try {
                        const element = diagramPlaceholder(id);
                        if (element) {
                            const result = await mermaidModule.default.render('svg-' + id, code);
                            const image = document.createElement('img');
                            image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sanitizeDiagramSvg(result.svg));
                            image.alt = 'Mermaid diagram';
                            element.replaceChildren(image);
                            element.classList.remove('mermaid-placeholder');
                            element.classList.add('mermaid-container');
                        }
                    } catch (e) {
                        const element = diagramPlaceholder(id);
                        if (element) {
                            const message = e instanceof Error ? e.message : String(e);
                            element.innerHTML = sanitizeHtml(
                                `<pre><code>${escapeHtml(code)}</code></pre><p class="error-msg">Mermaid 渲染错误: ${escapeHtml(message)}</p>`
                            );
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
            const content = marked.parse(text.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, ''));
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
        const text = token.tokens ? this.parser.parseInline(token.tokens) : escapeHtml(token.text || '');
        const safeHref = sanitizeLinkHref(href);
        const isExternal = safeHref.startsWith('http://') || safeHref.startsWith('https://');
        const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${safeHref}"${target}${titleAttr}>${text}</a>`;
    },

    image(token) {
        const url = safeImageUrl(token.href);
        if (!url) return escapeHtml(token.text || '');
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(token.text || '')}" referrerpolicy="no-referrer" loading="lazy">`;
    }
};

marked.use({ renderer });

export function renderMarkdown(text) {
    if (!text) return '';
    try {
        const html = marked.parse(text);
        return sanitizeHtml(html);
    } catch (e) {
        console.error('Markdown parse error:', e);
        return sanitizeHtml(escapeHtml(text));
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
