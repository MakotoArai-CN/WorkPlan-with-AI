// Tool adapters declare semantics; the execution loop has no business names,
// directory aliases or natural-language intent rules of its own.
export function describeOperation(call, args) {
    const identity = { ...args };
    for (const field of ['message', 'response_goal', 'reason', 'summary']) delete identity[field];
    const readOnly = call.name === 'workplan_read_data' || call.name === 'workplan_web_search'
        || call.name === 'workplan_local_file' && ['search', 'read'].includes(args.operation)
        || ['workplan_notes_action', 'workplan_worklog_action'].includes(call.name) && args.action === 'list'
        || call.name === 'workplan_project_action' && args.operation === 'query';
    const resource = call.name === 'workplan_notes_action' ? 'notes'
        : call.name === 'workplan_worklog_action' ? args.kind === 'leave' ? 'leave' : 'overtime' : null;
    return {
        identity, readOnly,
        invalidates: resource && ['update', 'delete'].includes(args.action) && args.id
            ? [{ source: resource, id: args.id }, ...(resource === 'notes' ? [{ source: 'current_note', id: args.id }] : [])] : []
    };
}
