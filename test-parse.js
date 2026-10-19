/* 智能识别解析层单测：node test-parse.js
 * 只用 Node 内置 assert，零依赖。课程表直接用 seed.js 的 13 门真实课程。
 */
'use strict';
var assert = require('assert');
var P = require('./parse.js');
var Seed = require('./seed.js');

var pass = 0;
var fail = 0;
var failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    failures.push(name + ' → ' + e.message);
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

var COURSES = Seed.courses;
var MON = '2026-10-19'; // 周一

/* ---------------- 日期解析 ---------------- */

test('完整日期三种写法', function () {
  assert.strictEqual(P.parseDueDate('2026-10-24', MON), '2026-10-24');
  assert.strictEqual(P.parseDueDate('2026/10/24', MON), '2026-10-24');
  assert.strictEqual(P.parseDueDate('2026年10月24日', MON), '2026-10-24');
});

test('省略年份的月日', function () {
  assert.strictEqual(P.parseDueDate('10月24日', MON), '2026-10-24');
  assert.strictEqual(P.parseDueDate('10-24', MON), '2026-10-24');
  assert.strictEqual(P.parseDueDate('10/24交', MON), '2026-10-24');
});

test('跨年：12 月看到「1月5日」应该算明年', function () {
  assert.strictEqual(P.parseDueDate('1月5日', '2026-12-20'), '2027-01-05');
});

test('明天 / 后天 / 大后天', function () {
  assert.strictEqual(P.parseDueDate('明天交', MON), '2026-10-20');
  assert.strictEqual(P.parseDueDate('后天', MON), '2026-10-21');
  assert.strictEqual(P.parseDueDate('大后天', MON), '2026-10-22');
});

test('本周五 / 下周三 / 只说周五', function () {
  assert.strictEqual(P.parseDueDate('本周五前', MON), '2026-10-23');
  assert.strictEqual(P.parseDueDate('下周三', MON), '2026-10-28');
  assert.strictEqual(P.parseDueDate('周五', MON), '2026-10-23');
});

test('周五已过时说「周五」应指下一个周五', function () {
  assert.strictEqual(P.parseDueDate('周五', '2026-10-24'), '2026-10-30'); // 10-24 是周六
});

test('周日 / 星期天 同义', function () {
  assert.strictEqual(P.parseDueDate('本周日', MON), '2026-10-25');
  assert.strictEqual(P.parseDueDate('星期天', MON), '2026-10-25');
});

test('三日内 / 一周内', function () {
  assert.strictEqual(P.parseDueDate('3日内', MON), '2026-10-22');
  assert.strictEqual(P.parseDueDate('一周内', MON), '2026-10-26');
});

test('非法日期返回 null（2 月 30 日）', function () {
  assert.strictEqual(P.parseDueDate('2月30日', MON), null);
  assert.strictEqual(P.parseDueDate('13月1日', MON), null);
});

test('认不出来就 null，不瞎猜', function () {
  assert.strictEqual(P.parseDueDate('尽快', MON), null);
  assert.strictEqual(P.parseDueDate('', MON), null);
  assert.strictEqual(P.parseDueDate(null, MON), null);
});

/* ---------------- 课程匹配 ---------------- */

test('全称精确匹配', function () {
  assert.strictEqual(P.matchCourse('高等数学A(1)', COURSES).id, 'math');
  assert.strictEqual(P.matchCourse('程序设计(C语言)', COURSES).id, 'c-lang');
});

test('口语简称能对上', function () {
  assert.strictEqual(P.matchCourse('高数', COURSES).id, 'math');
  assert.strictEqual(P.matchCourse('C语言作业', COURSES).id, 'c-lang');
  assert.strictEqual(P.matchCourse('大物', COURSES).id, 'physics');
  assert.strictEqual(P.matchCourse('物理实验', COURSES).id, 'phys-lab');
  assert.strictEqual(P.matchCourse('思修', COURSES).id, 'ethics');
  assert.strictEqual(P.matchCourse('形政', COURSES).id, 'policy');
});

test('从整句话里捞出课程', function () {
  assert.strictEqual(P.matchCourse('高等数学第三章课后习题', COURSES).id, 'math');
  assert.strictEqual(P.matchCourse('明天交大学物理实验报告', COURSES).id, 'phys-lab');
});

test('无关内容返回 null', function () {
  assert.strictEqual(P.matchCourse('今天食堂有红烧肉', COURSES), null);
  assert.strictEqual(P.matchCourse('', COURSES), null);
});

/* ---------------- 时长猜测 ---------------- */

test('按动词猜时长', function () {
  assert.strictEqual(P.estMinGuess('写实验报告'), 60);
  assert.strictEqual(P.estMinGuess('编程实现链表'), 45);
  assert.strictEqual(P.estMinGuess('课后习题 1-8 题'), 40);
  assert.strictEqual(P.estMinGuess('预习第 4 章'), 20);
  assert.strictEqual(P.estMinGuess('整理笔记'), 30);
});

/* ---------------- 提示词与请求体 ---------------- */

test('提示词里带课程列表和今天日期', function () {
  var p = P.buildPrompt(['高等数学A(1)', '大学化学'], MON);
  assert.ok(p.indexOf('高等数学A(1) / 大学化学') >= 0, '应含课程列表');
  assert.ok(p.indexOf('2026-10-19') >= 0, '应含今天日期');
  assert.ok(p.indexOf('只输出一个 JSON') >= 0, '应约束输出格式');
});

test('messages 结构：先图后文', function () {
  var msgs = P.buildMessages(['高等数学A(1)'], MON, 'data:image/jpeg;base64,AAA');
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].role, 'user');
  assert.strictEqual(msgs[0].content[0].type, 'image_url');
  assert.strictEqual(msgs[0].content[0].image_url.url, 'data:image/jpeg;base64,AAA');
  assert.strictEqual(msgs[0].content[1].type, 'text');
});

test('请求体默认模型与参数', function () {
  var body = P.buildRequestBody('', [{ role: 'user', content: [] }]);
  assert.strictEqual(body.model, 'glm-4v-flash');
  assert.strictEqual(body.stream, false);
  assert.ok(body.max_tokens > 0);
  assert.strictEqual(P.buildRequestBody('glm-4v-plus', []).model, 'glm-4v-plus');
});

/* ---------------- 模型返回清洗 ---------------- */

function norm(text, extra) {
  var ctx = { today: MON, courses: COURSES };
  if (extra) for (var k in extra) ctx[k] = extra[k];
  return P.normalizeResult(text, ctx);
}

test('标准 JSON 直接入库', function () {
  var r = norm('{"isTask":true,"course":"高等数学A(1)","title":"做习题 3.2 第 1-8 题","dueOn":"2026-10-23","estMin":40}');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.task.courseId, 'math');
  assert.strictEqual(r.task.dueOn, '2026-10-23');
  assert.strictEqual(r.task.estMin, 40);
  assert.deepStrictEqual(r.warnings, []);
});

test('```json 代码块包裹也能解析', function () {
  var r = norm('```json\n{"isTask":true,"course":"高数","title":"习题","dueOn":"10月24日","estMin":30}\n```');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.task.courseId, 'math');
  assert.strictEqual(r.task.dueOn, '2026-10-24');
});

test('前后夹着废话也能抠出 JSON', function () {
  var r = norm('好的，我看到了：\n{"isTask":true,"course":"大学化学","title":"完成实验报告","dueOn":"明天","estMin":60}\n还需要别的吗？');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.task.courseId, 'chem');
  assert.strictEqual(r.task.dueOn, '2026-10-20');
});

test('isTask=false 但 raw 有字 → 摊成可编辑草稿，不是死胡同', function () {
  var r = norm('{"isTask":false,"raw":"第 4 章 导数；习题 4.1 第 1-5 题"}');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.draft, true);
  assert.strictEqual(r.reason, 'no-task');
  assert.ok(r.tasks.length >= 1);
  assert.ok(r.tasks.some(function (t) { return t.title.indexOf('习题 4.1') >= 0; }));
});

test('完全不是 JSON → 仍然把句子摊成草稿', function () {
  var r = norm('明天交高数习题 4.1；周五交英语作文');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.draft, true);
  assert.strictEqual(r.reason, 'not-json');
  assert.strictEqual(r.tasks.length, 2);
  assert.strictEqual(r.tasks[0].courseId, 'math');
  assert.strictEqual(r.tasks[0].dueOn, '2026-10-20');
  assert.strictEqual(r.tasks[1].dueOn, '2026-10-23');
});

test('没给截止日 → 默认明天并给出提示', function () {
  var r = norm('{"isTask":true,"course":"高数","title":"习题","estMin":30}');
  assert.strictEqual(r.task.dueOn, '2026-10-20');
  assert.ok(r.warnings.some(function (w) { return w.indexOf('默认明天') >= 0; }));
});

test('模型给的日期已过期 → 改成明天并提示', function () {
  var r = norm('{"isTask":true,"course":"高数","title":"习题","dueOn":"2026-10-01","estMin":30}');
  assert.strictEqual(r.task.dueOn, '2026-10-20');
  assert.ok(r.warnings.some(function (w) { return w.indexOf('已经过去') >= 0; }));
});

test('认不出课程 → 课程留空 + 提示', function () {
  var r = norm('{"isTask":true,"course":"火星殖民导论","title":"写 500 字感想","dueOn":"明天","estMin":30}');
  assert.strictEqual(r.task.courseId, '');
  assert.ok(r.warnings.some(function (w) { return w.indexOf('哪门课') >= 0; }));
});

test('只有 raw 没有 title → 用 raw 当标题', function () {
  var r = norm('{"isTask":true,"raw":"下周三交 高数 习题 4.1"}');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.task.title, '下周三交 高数 习题 4.1');
  assert.strictEqual(r.task.courseId, 'math');
  assert.strictEqual(r.task.dueOn, '2026-10-28'); // 从 raw 里捞出「下周三」
});

test('没有标题也没 raw → 让用户手填', function () {
  var r = norm('{"isTask":true}');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-title');
});

test('estMin 越界会被夹到 5–240', function () {
  assert.strictEqual(norm('{"isTask":true,"title":"x","estMin":9999}').task.estMin, 240);
  assert.strictEqual(norm('{"isTask":true,"title":"x","estMin":-3}').task.estMin, 30); // 非法 → 按标题猜（无关键词 = 30）
});

test('标题超长截断到 60 字', function () {
  var long = new Array(200).join('字');
  var r = norm('{"isTask":true,"title":"' + long + '","estMin":30}');
  assert.strictEqual(r.task.title.length, 60);
});

test('JSON 里带转义引号也能解析', function () {
  var r = norm('{"isTask":true,"title":"完成「实验2」的报告","course":"大学化学实验","estMin":60}');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.task.courseId, 'chem-lab');
});

/* ---------------- 一张图多条作业 ---------------- */

test('多条 tasks 全部保留，不合并', function () {
  var r = norm(JSON.stringify({
    tasks: [
      { course: '高等数学A(1)', title: '习题 4.1 第 1-5 题', dueOn: '2026-10-20', estMin: 40 },
      { course: '大学英语C(1)', title: '写一篇 200 词作文', dueOn: '2026-10-23', estMin: 60 },
      { course: '', title: '预习第 5 章', dueOn: '', estMin: 20 }
    ],
    raw: '三条作业'
  }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.draft, false);
  assert.strictEqual(r.tasks.length, 3);
  assert.strictEqual(r.tasks[0].courseId, 'math');
  assert.strictEqual(r.tasks[1].courseId, 'english');
  assert.strictEqual(r.tasks[2].title, '预习第 5 章');
  assert.strictEqual(r.tasks[2].dueOn, '2026-10-20'); // 没写日期 → 明天
});

test('兼容旧格式 {task:{...}}', function () {
  var r = norm('{"task":{"course":"高数","title":"习题 3.2","dueOn":"2026-10-21","estMin":30}}');
  assert.strictEqual(r.tasks.length, 1);
  assert.strictEqual(r.tasks[0].courseId, 'math');
  assert.strictEqual(r.task.courseId, 'math'); // 向后兼容字段
});

test('模型直接吐数组也能吃', function () {
  var r = norm('[{"title":"A 作业","course":"大学化学"},{"title":"B 作业","course":"体育"}]');
  assert.strictEqual(r.tasks.length, 2);
  assert.strictEqual(r.tasks[0].courseId, 'chem');
});

test('字段名 name / content 也认', function () {
  assert.strictEqual(norm('{"name":"做实验报告","course":"大学化学实验"}').tasks[0].title, '做实验报告');
  assert.strictEqual(norm('{"content":"背 Unit 3","course":"英语"}').tasks[0].courseId, 'english');
});

test('超过 8 条只取前 8 条', function () {
  var many = { tasks: [] };
  for (var i = 0; i < 12; i++) many.tasks.push({ title: '作业' + i, course: '高数' });
  assert.strictEqual(norm(JSON.stringify(many)).tasks.length, 8);
});

test('兜底切行：去掉序号、分号切多条、过滤空行', function () {
  var r = P.fallbackTasks('1. 习题 1.2 第 3-8 题；2、实验报告\n\n  \n(3) 背单词', { today: MON, courses: COURSES });
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[0].title, '习题 1.2 第 3-8 题');
  assert.strictEqual(r[1].title, '实验报告');
  assert.strictEqual(r[2].title, '背单词');
});

test('兜底草稿也能猜出课程和截止日', function () {
  var r = P.fallbackTasks('高数 下周三前交习题 4.2', { today: MON, courses: COURSES });
  assert.strictEqual(r[0].courseId, 'math');
  assert.strictEqual(r[0].dueOn, '2026-10-28');
});


test('HTTP 错误翻译成人话', function () {
  assert.ok(P.explainError(401).indexOf('Key 无效') >= 0);
  assert.ok(P.explainError(403).indexOf('Key 无效') >= 0);
  assert.ok(P.explainError(429).indexOf('额度') >= 0);
  assert.ok(P.explainError(404).indexOf('模型名') >= 0);
  assert.ok(P.explainError(500).indexOf('服务') >= 0);
  assert.ok(P.explainError(0).indexOf('连不上') >= 0);
  assert.ok(P.explainError(400, '{"error":{"message":"invalid param"}}').indexOf('invalid param') >= 0);
});

/* ---------------- 汇总 ---------------- */

console.log('\n通过 ' + pass + '，失败 ' + fail);
if (fail) {
  console.log('\n失败明细：');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
