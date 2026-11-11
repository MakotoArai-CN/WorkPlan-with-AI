import { expect, test } from 'bun:test';
import { requestsApplicationData } from '../src/lib/utils/ai-data-policy.js';

test('application data access requires a current explicit request, not a generic topic', () => {
    for (const text of ['你好', '解释一下彩虹', '今天开会好累', '分析这段文章', '分析笔记软件的优缺点', '创建任务模板示例', '分析工资的定义', '写一个任务队列函数', '解释 prompt template', 'Plan a trip to Japan', 'search latest news']) {
        expect(requestsApplicationData(text)).toBe(false);
    }
    for (const text of ['查看我的任务', '分析本周任务完成率', '删除任务A', '请润色这篇工作笔记', '查询加班记录', '列出我的笔记', 'Show my tasks', 'Summarize my worklog']) {
        expect(requestsApplicationData(text)).toBe(true);
    }
});
