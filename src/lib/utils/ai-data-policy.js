// This is an authorization boundary, not a model classifier. Ambiguous ordinary
// conversation must not cause a model to opt itself into application data.
export function requestsApplicationData(value = '') {
    const text = String(value).trim();
    if (!text) return false;
    if (/(?:示例|教程|原理|是什么|优缺点|概念|软件|最佳实践|代码|算法|定义|\bexample\b|\btutorial\b|\bwhat is\b|\bsoftware\b)/i.test(text)
        && !/本应用|应用内|WorkPlan|我的(?:任务|笔记|待办|记录)|\bmy\s+(?:tasks?|notes?|worklog)/i.test(text)) return false;
    if (/(?:代码|函数|编程|示例|code|function|programming).{0,15}(?:任务|模板|task|template)|(?:任务队列|task queue|prompt template)/i.test(text)
        && !/本应用|应用内|WorkPlan|我的(?:任务|笔记|待办|记录)/i.test(text)) return false;
    const entity = '(?:任务|待办|看板|子任务|工作笔记|笔记|任务模板|定时任务|工时|加班|请假|工资|薪资|工资单|task(?:s)?|todo|kanban|note(?:s)?|scheduled task|worklog|overtime|leave record|payroll)';
    return new RegExp(`(?:我的|应用内|本应用|WorkPlan|my|in this app).{0,20}${entity}`, 'i').test(text)
        || new RegExp(`(?:查看|查询|列出|总结|分析|整理|创建|添加|新增|记录|删除|修改|更新|完成|标记|打开|读取|保存|润色|扩写|续写|提取|生成大纲|show|list|summarize|analyse|analyze|create|add|delete|update|complete|read|save).{0,18}${entity}`, 'i').test(text)
        || new RegExp(`${entity}.{0,18}(?:有哪些|有什么|多少|情况|完成率|统计|总结|分析|润色|扩写|续写|提取|生成大纲|怎么安排|summary|status|statistics)`, 'i').test(text);
}
