import { describe, expect, test } from 'bun:test';
import {
    createEncryptedBackup,
    openEncryptedBackup,
    isEncryptedBackup,
    validateBackupData
} from '../src/lib/utils/backup-package.js';

const payload = {
    format: 'workplan-backup-data',
    version: 1,
    capturedAt: '2026-10-29T00:00:00.000Z',
    appVersion: '0.4.2',
    keys: {
        planpro_tasks_local_cache: JSON.stringify({ tasks: [{ id: '1', title: '机密任务' }] }),
        planpro_passwords: JSON.stringify([{ title: '邮箱', password: 'encrypted' }])
    }
};

describe('WorkPlan encrypted backup package', () => {
    test('round-trips the full local payload with the user password', async () => {
        const packageValue = await createEncryptedBackup(payload, 'correct horse battery');
        expect(isEncryptedBackup(packageValue)).toBe(true);
        expect(packageValue.format).toBe('workplan-secure-backup');
        expect(packageValue.payload).not.toContain('机密任务');
        const opened = await openEncryptedBackup(packageValue, 'correct horse battery');
        expect(opened).toEqual(payload);
        expect(validateBackupData(opened).planpro_tasks_local_cache).toContain('机密任务');
    });

    test('rejects the wrong master password', async () => {
        const packageValue = await createEncryptedBackup(payload, 'correct horse battery');
        await expect(openEncryptedBackup(packageValue, 'wrong password')).rejects.toThrow('主密码错误');
    });

    test('rejects a tampered ciphertext', async () => {
        const packageValue = await createEncryptedBackup(payload, 'correct horse battery');
        packageValue.payload = packageValue.payload.slice(0, -8) + 'AAAAAAAA';
        await expect(openEncryptedBackup(packageValue, 'correct horse battery')).rejects.toThrow('主密码错误');
    });
});
