const FIELDS = {
    tasks: ['id', 'title', 'status', 'priority', 'date', 'deadline', 'note', 'subtasks'],
    templates: ['id', 'title', 'status', 'priority', 'note', 'subtasks'],
    scheduled: ['id', 'title', 'date', 'repeatDays', 'enabled', 'note'],
    overtime: ['id', 'date', 'start', 'end', 'hours', 'type', 'compensation', 'note'],
    leave: ['id', 'startDate', 'endDate', 'duration', 'unit', 'type', 'paid', 'note']
};

export async function queryApplicationData(args, { context, getNotes, getProjects, getProjectsSnapshot, overtimeEnabled }) {
    if (String(args.query || '').length > 200) return { data: { error: '查询关键词过长，请缩小范围。' } };
    if (args.source === 'current_note' || args.source === 'notes') {
        const state = getNotes();
        const current = args.source === 'current_note';
        const selected = Object.hasOwn(state, 'activeNoteId') ? state.activeNoteId : context.activeNoteId;
        const id = current ? selected : args.id;
        if (current && !id) return { data: { error: '没有选中的当前笔记，请先选择笔记。' } };
        if (id) {
            const note = (state.notes || []).find(item => item.id === id);
            if (!note || note.aiLocked) return { data: { error: '笔记不存在或已禁止AI访问。' } };
            const start = args.content_offset || 0;
            const body = String(note.content || '');
            return {
                data: { source: args.source, note: { id: note.id, title: String(note.title || '').slice(0, 300),
                    category: String(note.category || '').slice(0, 100), content: body.slice(start, start + 8000),
                    contentOffset: start, totalCharacters: body.length, truncated: body.length > start + 8000 } },
                isCurrent: () => {
                    const next = getNotes();
                    return next.notes?.find(item => item.id === id) === note && !note.aiLocked
                        && (!current || (Object.hasOwn(next, 'activeNoteId') ? next.activeNoteId : context.activeNoteId) === id);
                }
            };
        }
        const query = String(args.query || '').toLowerCase();
        const visible = (state.notes || []).filter(note => !note.aiLocked && String(note.title || '').toLowerCase().includes(query));
        const offset = args.offset || 0;
        const records = visible.slice(offset, offset + (args.limit || 10));
        return {
            data: { source: 'notes', total: visible.length, offset, records: records.map(note => ({
                id: note.id, title: String(note.title || '').slice(0, 300), category: String(note.category || '').slice(0, 100)
            })) },
            isCurrent: () => records.every(note => getNotes().notes?.find(item => item.id === note.id) === note && !note.aiLocked)
        };
    }
    if (!FIELDS[args.source]) return { data: { error: '不允许查询此数据类型。密码库不可访问。' } };
    if (['overtime', 'leave'].includes(args.source) && !overtimeEnabled()) return { data: { error: '工时功能未启用。' } };
    const state = await getProjects();
    const key = { tasks: 'tasks', templates: 'templates', scheduled: 'scheduledTasks', overtime: 'overtimeRecords', leave: 'leaveRecords' }[args.source];
    const query = String(args.query || '').toLowerCase();
    const visible = (state[key] || []).filter(item => !item.aiLocked && (!args.id || item.id === args.id)
        && `${item.title || ''} ${item.note || ''} ${item.date || ''}`.toLowerCase().includes(query));
    const offset = args.offset || 0;
    const records = visible.slice(offset, offset + (args.limit || 10));
    return {
        data: { source: args.source, total: visible.length, offset, records: records.map(item => Object.fromEntries(
            FIELDS[args.source].filter(field => item[field] !== undefined).map(field => [field,
                typeof item[field] === 'string' ? item[field].slice(0, 600) : field === 'subtasks'
                    ? (item.subtasks || []).slice(0, 20).map(sub => ({ title: String(sub.title || sub).slice(0, 150), status: sub.status })) : item[field]
            ])
        )) },
        isCurrent: () => records.every(item => !item.aiLocked && getProjectsSnapshot()?.[key]?.find(next => next.id === item.id) === item)
    };
}
