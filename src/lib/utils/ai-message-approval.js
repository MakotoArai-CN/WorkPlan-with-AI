const APPROVAL_TYPES = new Set([
    'task_card', 'multi_task_card', 'delete_confirm', 'update_confirm',
    'multi_update_confirm', 'batch_complete_confirm', 'mixed_confirm', 'subtask_confirm'
]);
const COMPARED_FIELDS = ['title', 'status', 'priority', 'date', 'deadline', 'note', 'subtasks', 'repeatDays', 'enabled'];

function targetsFor(message) {
    if (message.type === 'task_card' || message.type === 'multi_task_card') return [];
    return [
        ...(message.task ? [message.task] : []), ...(message.tasks || []),
        ...(message.operations || []).map(operation => operation?.task),
        ...(message.updateOps || []).map(operation => operation?.task), ...(message.deleteOps || [])
    ];
}

// A confirmation authorizes the displayed proposal against the displayed data,
// not whichever account, panel or task happens to be selected after the dialog.
export function captureMessageApproval({ message, getMessage, getItems, getContext, isOperationCurrent }) {
    if (!message || !APPROVAL_TYPES.has(message.type) || message.confirmed) return () => false;
    if (message.type === 'multi_task_card' && (!Array.isArray(message.tasks) || message.tasks.length > 100)) return () => false;
    if (['tasks', 'operations', 'updateOps', 'deleteOps'].some(field => message[field] !== undefined && !Array.isArray(message[field]))) return () => false;
    if (message.type === 'task_card' && (!message.data || typeof message.data.title !== 'string')) return () => false;
    if (['update_confirm', 'subtask_confirm'].includes(message.type) && !message.task) return () => false;
    if (message.type === 'delete_confirm' && !message.tasks?.length) return () => false;
    if (['multi_update_confirm', 'batch_complete_confirm'].includes(message.type) && !message.operations?.length) return () => false;
    if (message.type === 'mixed_confirm' && !message.updateOps?.length && !message.deleteOps?.length) return () => false;
    let proposal;
    try { proposal = JSON.stringify(message); } catch { return () => false; }
    if (proposal.length > 262144) return () => false;
    const items = getItems();
    const context = getContext();
    if (!Array.isArray(items)) return () => false;
    const targets = targetsFor(message);
    if (targets.length > 100 || targets.some(target => {
        if (!target || !['string', 'number'].includes(typeof target.id)) return true;
        const current = items.find(item => item.id === target.id);
        return !current || COMPARED_FIELDS.some(field => Object.hasOwn(target, field)
            && JSON.stringify(target[field]) !== JSON.stringify(current[field]));
    })) return () => false;
    return () => {
        if (!isOperationCurrent() || getMessage() !== message || message.confirmed || getItems() !== items || getContext() !== context) return false;
        try { return JSON.stringify(message) === proposal; } catch { return false; }
    };
}
