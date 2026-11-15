import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { needsSnapshotTransfer, saveSnapshotTransfer } from '../src/lib/utils/snapshot-transfer.js';

function receiver({ failAt = '', signal, cancelAt = '' } = {}) {
    const calls = [], keys = {}, hash = createHash('sha256');
    let entry = -1, offset = 0;
    let committed = false;
    const number = value => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; };
    const invoke = async (command, args) => {
        calls.push({ command, args });
        if (command === failAt) throw Error('Synthetic ' + command + ' failure');
        if (command === 'local_db_transfer_begin') return 'native-generated-transfer-id';
        if (command === 'local_db_transfer_append') {
            expect(args.data.length).toBeLessThanOrEqual(16384);
            expect(args.data.isWellFormed()).toBe(true);
            expect(args.id).toBe('native-generated-transfer-id');
            if (entry !== args.index) {
                expect(args.index).toBe(entry + 1);
                entry = args.index; offset = 0;
                keys[args.key] = '';
                hash.update(number(Buffer.byteLength(args.key)));
                hash.update(args.key); hash.update(number(args.length));
            }
            expect(args.offset).toBe(offset);
            offset += args.data.length;
            keys[args.key] += args.data;
            hash.update(args.data);
            if (args.last) expect(offset).toBe(args.length);
        }
        if (command === cancelAt) signal.abort();
        if (command === 'local_db_transfer_commit') {
            expect(args.digest).toBe(hash.digest('hex'));
            committed = true;
            return { exists: true };
        }
        return undefined;
    };
    return { calls, keys, invoke, get committed() { return committed; } };
}

test('large Unicode snapshots are transferred in bounded parts with a native-verifiable digest', async () => {
    const snapshot = { format: 'workplan-local-db', version: 1, savedAt: 123, keys: {
        workplan_notes: 'a'.repeat(16383) + '\u{1f600}' + '\n"\\中文'.repeat(12000),
        planpro_tasks: '', workplan_meta: 'small'
    } };
    const target = receiver();
    const result = await saveSnapshotTransfer(snapshot, target.invoke);
    expect(result.exists).toBe(true);
    expect(target.keys).toEqual(snapshot.keys);
    expect(target.committed).toBe(true);
    expect(target.calls.at(-1).command).toBe('local_db_transfer_commit');
    const first = target.calls[0].args;
    expect(first.entries).toBe(3);
    expect(first.units).toBe(Object.entries(snapshot.keys).reduce((n, [k,v]) => n + k.length + v.length, 0));
});

for (const command of ['local_db_transfer_begin', 'local_db_transfer_append', 'local_db_transfer_commit']) {
    test(`failed ${command} never reports success and aborts a known transfer`, async () => {
        const target = receiver({ failAt: command });
        await expect(saveSnapshotTransfer({ savedAt: 123, keys: { workplan_notes: 'x'.repeat(40000) } }, target.invoke)).rejects.toThrow('Synthetic');
        expect(target.committed).toBe(false);
        expect(target.calls.at(-1).command).toBe(command === 'local_db_transfer_begin' ? command : 'local_db_transfer_abort');
    });
}

test('cancellation during a chunk aborts without commit and the exact snapshot can be retried', async () => {
    const signal = new AbortController();
    const snapshot = { savedAt: 123, keys: { workplan_notes: 'x'.repeat(40000) } };
    const target = receiver({ signal, cancelAt: 'local_db_transfer_append' });
    await expect(saveSnapshotTransfer(snapshot, target.invoke, { signal: signal.signal })).rejects.toThrow('canceled');
    expect(target.committed).toBe(false);
    expect(target.calls.at(-1).command).toBe('local_db_transfer_abort');
    const retry = receiver();
    await saveSnapshotTransfer(snapshot, retry.invoke);
    expect(retry.keys).toEqual(snapshot.keys);
});

test('small snapshots keep direct IPC, large normal snapshots use transfer, old huge key names keep compatibility', () => {
    expect(needsSnapshotTransfer({ workplan_notes: '[]' })).toBe(false);
    expect(needsSnapshotTransfer({ workplan_notes: 'x'.repeat(70000) })).toBe(true);
    expect(needsSnapshotTransfer({ ['workplan_' + 'x'.repeat(17000)]: 'x'.repeat(70000) })).toBe(false);
});

test('cancellation can interrupt an in-flight commit before the native commit boundary', async () => {
    const controller = new AbortController();
    let commitStarted, rejectCommit, aborts = 0;
    const started = new Promise(resolve => { commitStarted = resolve; });
    const invoke = async command => {
        if (command === 'local_db_transfer_begin') return 'native-id';
        if (command === 'local_db_transfer_commit') {
            commitStarted();
            return new Promise((_, reject) => { rejectCommit = reject; });
        }
        if (command === 'local_db_transfer_abort') {
            aborts++;
            rejectCommit?.(Error('Native preparation canceled'));
        }
    };
    const job = saveSnapshotTransfer({ savedAt: 1, keys: { workplan_notes: 'data' } }, invoke, { signal: controller.signal });
    const outcome = job.then(() => null, error => error);
    await started;
    controller.abort();
    expect((await outcome)?.message).toBe('Native preparation canceled');
    expect(aborts).toBeGreaterThanOrEqual(1);
});

test('a commit already accepted by native code is reported as success, not a retryable cancellation', async () => {
    const controller = new AbortController();
    const target = receiver();
    const result = await saveSnapshotTransfer({ savedAt: 1, keys: { workplan_notes: 'data' } }, async (command, args) => {
        const result = await target.invoke(command, args);
        if (command === 'local_db_transfer_abort') throw Error('Commit boundary reached');
        if (command === 'local_db_transfer_commit') controller.abort();
        return result;
    }, { signal: controller.signal });
    expect(result.exists).toBe(true);
    expect(target.committed).toBe(true);
});

test('a reload cancels only its remembered native transfer before starting a new save', () => {
    const script = `
        import assert from 'node:assert/strict';
        import {saveSnapshotTransfer} from './src/lib/utils/snapshot-transfer.js';
        const key='workplan_snapshot_transfer',old='a'.repeat(32),next='b'.repeat(32),data=new Map([[key,old]]);
        globalThis.sessionStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
        const calls=[];
        const invoke=async(command,args)=>{
            calls.push([command,args]);
            if(command==='local_db_transfer_begin'){assert.equal(data.has(key),false);return next;}
            if(command==='local_db_transfer_append')assert.equal(data.get(key),next);
            if(command==='local_db_transfer_commit')return {exists:true};
        };
        await saveSnapshotTransfer({savedAt:1,keys:{workplan_notes:'synthetic'}},invoke);
        assert.deepEqual(calls[0],['local_db_transfer_abort',{id:old}]);
        assert.equal(data.has(key),false);
        data.set(key,old);
        let began=false;
        await assert.rejects(saveSnapshotTransfer({savedAt:1,keys:{workplan_notes:'synthetic'}},async command=>{
            if(command==='local_db_transfer_abort')throw Error('Native commit still in progress');
            began=true;
        }),/still in progress/);
        assert.equal(began,false);assert.equal(data.get(key),old);
        data.set(key,'not-a-native-transfer-id');calls.length=0;
        await saveSnapshotTransfer({savedAt:1,keys:{workplan_notes:'synthetic'}},async(command,args)=>{
            calls.push(command);
            if(command==='local_db_transfer_begin')return next;
            if(command==='local_db_transfer_commit')return {exists:true};
        });
        assert.equal(calls[0],'local_db_transfer_begin');
        assert.equal(data.has(key),false);
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000
    });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
});

test('blocked session storage does not prevent saving or weaken native transfer checks', () => {
    const script = `
        import assert from 'node:assert/strict';
        import {saveSnapshotTransfer} from './src/lib/utils/snapshot-transfer.js';
        Object.defineProperty(globalThis,'sessionStorage',{get(){throw Error('Storage blocked');}});
        let parts=0;
        const result=await saveSnapshotTransfer({savedAt:1,keys:{workplan_notes:'data'}},async command=>{
            if(command==='local_db_transfer_begin')return 'a'.repeat(32);
            if(command==='local_db_transfer_append')parts++;
            if(command==='local_db_transfer_commit')return {exists:true};
        });
        assert.equal(parts,1);assert.equal(result.exists,true);
    `;
    const result = Bun.spawnSync([process.execPath, '--eval', script], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000
    });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
});
