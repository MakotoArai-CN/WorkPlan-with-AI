import createDOMPurify from 'dompurify';
import { escapeHtml, safeImageUrl, safeInlineStyle, safeLinkUrl } from './safe-content.js';

const purifier = typeof window === 'undefined' ? null : createDOMPurify(window);
const FORBIDDEN_TAGS = [
    'script', 'style', 'iframe', 'frame', 'object', 'embed', 'foreignObject',
    'form', 'button', 'textarea', 'select', 'option', 'base', 'link', 'meta',
    'video', 'audio', 'source', 'image', 'use', 'animate', 'animateMotion', 'animateTransform', 'set'
];

purifier?.addHook('afterSanitizeAttributes', (node, _data, config) => {
    for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLowerCase();
        if ((name === 'id' || name === 'name') && attribute.value.startsWith('user-content-')) {
            node.setAttribute(attribute.name, attribute.value.replace(/^(?:user-content-)+/, 'user-content-'));
        } else if (name === 'style') {
            const style = safeInlineStyle(attribute.value);
            if (style) node.setAttribute('style', style);
            else node.removeAttribute('style');
        } else if (name === 'href' || name === 'xlink:href') {
            const value = safeLinkUrl(attribute.value);
            if (value) node.setAttribute(attribute.name,
                config.SANITIZE_NAMED_PROPS && value.startsWith('#') && !value.startsWith('#user-content-')
                    ? `#user-content-${value.slice(1)}` : value);
            else node.removeAttribute(attribute.name);
        } else if (name === 'src') {
            const value = node.tagName?.toLowerCase() === 'img' ? safeImageUrl(attribute.value) : '';
            if (value) node.setAttribute('src', value);
            else node.removeAttribute('src');
        } else if (['srcset', 'poster', 'action', 'formaction', 'background'].includes(name)) {
            node.removeAttribute(attribute.name);
        }
    }
    if (node.tagName?.toLowerCase() === 'a') {
        node.setAttribute('rel', 'noopener noreferrer');
        node.setAttribute('target', '_blank');
    }
    if (node.tagName?.toLowerCase() === 'img') node.setAttribute('referrerpolicy', 'no-referrer');
    if (node.tagName?.toLowerCase() === 'input') {
        if (node.getAttribute('type') !== 'checkbox') node.remove();
        else node.setAttribute('disabled', '');
    }
});

export function sanitizeHtml(html) {
    if (!purifier?.isSupported) return escapeHtml(html);
    return purifier.sanitize(String(html ?? ''), {
        USE_PROFILES: { html: true, svg: true, mathMl: true },
        ADD_ATTR: ['target', 'rel', 'class', 'disabled', 'checked', 'type', 'aria-hidden', 'role', 'referrerpolicy'],
        FORBID_TAGS: FORBIDDEN_TAGS,
        FORBID_ATTR: ['srcset', 'contenteditable', 'autofocus', 'formaction'],
        ALLOW_DATA_ATTR: false,
        SANITIZE_NAMED_PROPS: true
    });
}

const UNSAFE_EDITOR_LANGUAGES = new Set([
    'mermaid', 'echarts', 'wavedrom', 'markmap', 'mindmap', 'flowchart',
    'plantuml', 'graphviz', 'abc', 'smiles'
]);

export function sanitizeEditorPreview(html) {
    const safe = sanitizeHtml(html);
    if (typeof document === 'undefined') return safe;
    const template = document.createElement('template');
    template.innerHTML = safe;
    for (const element of template.content.querySelectorAll('[class]')) {
        for (const name of [...element.classList]) {
            if (name.startsWith('language-') && UNSAFE_EDITOR_LANGUAGES.has(name.slice(9))) {
                // Vditor runs active diagram plugins *after* preview.transform.
                // Keep their code visible without handing it to those plugins.
                element.classList.replace(name, 'language-plaintext');
            }
        }
    }
    return template.innerHTML;
}

const hardenedEditors = new WeakSet();

export function hardenVditorLute(lute) {
    if (!lute || hardenedEditors.has(lute)) return lute;
    hardenedEditors.add(lute);
    const renderMethods = [
        'Md2VditorIRDOM', 'SpinVditorIRDOM', 'HTML2VditorIRDOM',
        'Md2VditorDOM', 'SpinVditorDOM', 'HTML2VditorDOM'
    ];
    for (const name of renderMethods) {
        if (typeof lute[name] !== 'function') continue;
        const render = lute[name].bind(lute);
        lute[name] = (...args) => {
            const html = render(...args);
            // Spin normally receives only the edited block. Do not parse
            // ordinary text/code merely containing the words "html-block".
            if (typeof html !== 'string' || !/\bdata-type=(["'])html-block\1/.test(html)
                || (!html.includes('vditor-ir__preview') && !html.includes('vditor-wysiwyg__preview'))) return html;
            const template = document.createElement('template');
            template.innerHTML = html;
            for (const preview of template.content.querySelectorAll('[data-type="html-block"] .vditor-ir__preview, [data-type="html-block"] .vditor-wysiwyg__preview')) {
                // Keep editable HTML source, never attach its live preview DOM.
                preview.replaceChildren();
                preview.setAttribute('data-render', '1');
            }
            return template.innerHTML;
        };
    }
    return lute;
}

export function sanitizeDiagramSvg(svg) {
    if (!purifier?.isSupported) return '';
    // SVG is displayed as an image document, never inserted into the app DOM.
    // Its CSS cannot restyle the WebView and links cannot navigate the app.
    return purifier.sanitize(String(svg ?? ''), {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['script', 'foreignObject', 'a', 'image', 'use', 'animate', 'animateMotion', 'animateTransform', 'set'],
        FORBID_ATTR: ['href', 'xlink:href', 'src'],
        ALLOW_DATA_ATTR: false
    });
}
