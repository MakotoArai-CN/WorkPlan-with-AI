const COMMON = new Set([
    'password', 'password1', 'password123', 'password123!', 'password@123',
    '12345678', '123456789', '1234567890', '123123123', '87654321',
    'qwerty123', 'qwertyuiop', 'qwertyui', 'asdfghjk', 'asdfghjkl',
    'admin123', 'admin1234', 'administrator', 'welcome1', 'welcome123',
    'letmein123', 'iloveyou', 'iloveyou123', 'abc12345', 'abc123456',
    '1qaz2wsx', '1q2w3e4r', '1q2w3e4r5t', 'qazwsxedc', 'changeme',
    'workplan', 'workplan123', 'p@ssw0rd', 'p@ssword', 'passw0rd',
    'abcdefgh', 'abcdefghij', 'abcd1234', 'qwer1234', 'zxcvbnm123',
    '11112222', '11223344', '987654321', '9876543210', '0123456789',
    'sunshine', 'football', 'baseball', 'superman', 'princess', 'trustno1',
    'letmein1', 'dragon123', 'monkey123', 'michael1', 'whatever', 'nothing1'
]);

const COMMON_BASE = /^(password|admin|administrator|welcome|workplan|qwerty|letmein|iloveyou|sunshine|football|baseball|superman|princess|dragon|monkey|michael|changeme|trustno)[\d\W_]*$/u;

// Apply to new masters only; existing weak masters must remain unlockable.
export function validateMasterPassword(password) {
    if (typeof password !== 'string' || password.length < 8) return 'too_short';
    const normalized = password.normalize('NFKC').trim().toLowerCase();
    if (normalized.length < 8 || COMMON.has(normalized)
        || /^(.)\1+$/u.test(normalized)
        || /^(\d{1,4})\1+$/u.test(normalized)
        || COMMON_BASE.test(normalized)) return 'weak';
    return null;
}
