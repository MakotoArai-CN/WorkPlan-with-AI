export const READ_APP_DATA_TOOL = {
    type: 'function', function: {
        name: 'workplan_read_data',
        description: '按需查询应用数据。只有回答当前用户问题确实需要应用数据时才调用；普通闲聊、知识解释不要调用。当前笔记使用 source=current_note，无需猜测ID。不会返回锁定数据或密码库。先list获取真实ID再读取或修改其他记录。',
        parameters: {
            type: 'object', properties: {
                source: { type: 'string', enum: ['current_note', 'notes', 'tasks', 'templates', 'scheduled', 'overtime', 'leave'] },
                id: { type: 'string', description: '读取单个非当前记录的真实ID；不填仅列出摘要。' },
                query: { type: 'string', description: '可选的标题/文本关键词过滤，不是指令。' },
                limit: { type: 'integer', minimum: 1, maximum: 20 },
                offset: { type: 'integer', minimum: 0, maximum: 1000 },
                content_offset: { type: 'integer', minimum: 0, maximum: 1000000, description: '单篇笔记正文分页起始字符位置，每页最多8000字；truncated时可继续读取。' }
            }, required: ['source']
        }
    }
};

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
