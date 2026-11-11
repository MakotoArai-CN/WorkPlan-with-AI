import { safeProviderError } from './ai-transport.js';

function language() {
    let value = typeof navigator === 'undefined' ? 'zh' : navigator.language;
    try { value = localStorage.getItem('workplan_locale') || value; } catch { /* Storage may be unavailable. */ }
    return String(value || 'zh').toLowerCase().split('-')[0];
}

export function g4fHttpStatus(error) {
    const status = Number(error?.status);
    if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
    const match = String(error?.message || error || '').match(/(?:Status|HTTP)\s*[:=]?\s*([45]\d{2})\b/i);
    return match ? Number(match[1]) : null;
}

export function g4fRequiresUserAction(error) {
    const status = g4fHttpStatus(error);
    return status !== null && status >= 400 && status < 500;
}

export function g4fRequestError(error, secrets = []) {
    const status = g4fHttpStatus(error);
    const message = safeProviderError(error, secrets);
    const isCake = status === 402 && /cake|proof.of.work/i.test(message);
    const locale = language();
    const hints = {
        zh: isCake
            ? 'G4F 匿名 cake 额度不足（402）。请在 AI 设置中打开 G4F 官方聊天页手动获取额度，或在会员页生成 API Key，选择 G4F Auto 后填写。浏览器登录不会自动同步到应用，匿名额度还可能受出口 IP 影响。未自动重试，也不会后台挖取额度。'
            : 'G4F 返回 402：当前账号或模型额度不足，请在服务商页面检查余额、权限和模型；未自动重试。',
        en: isCake
            ? 'G4F anonymous cake credits are exhausted (402). Open the official chat page from AI settings to earn credits manually, or generate a member API key and enter it under G4F Auto. Browser login is not shared with this app; anonymous credits may depend on the public IP. No automatic retry or background proof-of-work.'
            : 'G4F returned 402: check the provider balance, permissions and selected model. The request was not retried.',
        ja: isCake
            ? 'G4F の匿名 cake 残高が不足しています（402）。AI設定から公式チャットで手動取得するか、会員ページでAPIキーを作成し G4F Auto に入力してください。ブラウザーのログインはアプリに共有されず、匿名枠は接続元IPに依存する場合があります。自動再試行やバックグラウンド計算はしません。'
            : 'G4F が402を返しました。残高、権限、選択モデルを確認してください。自動再試行はしていません。'
    };
    const result = new Error(status === 402 ? hints[locale] || hints.en : `G4F 请求失败: ${message}`);
    result.status = status;
    result.code = status === 402 ? 'g4f_credit_required' : 'g4f_request_failed';
    return result;
}
