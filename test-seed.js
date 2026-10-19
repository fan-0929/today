/* 真实课表数据自检：node test-seed.js
 * 只验证 seed.js 里的课表有没有抄错、大纲课次和实际上课次数是否匹配。
 */
'use strict';
var assert = require('assert');
var R = require('./rules.js');
var Seed = require('./seed.js');

var pass = 0;
var fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

var st = Seed.defaultState();
var TERM_END = '2026-12-27'; // 第 16 周周日

function byId(id) {
  return st.courses.filter(function (c) { return c.id === id; })[0];
}
function dates(c) {
  return R.courseDatesBefore(c, st.termStart, TERM_END);
}

/* ---------- 1. 开课日 / 周次过滤 ---------- */

test('犯罪与预防：1-8 周共 8 次，最后一次是 10 月 30 日周五', function () {
  var d = dates(byId('crime'));
  assert.strictEqual(d.length, 8);
  assert.strictEqual(d[0], '2026-09-11');
  assert.strictEqual(d[7], '2026-10-30');
});

test('形势与政策：只在第 4/8/12/16 周的周四，共 4 次', function () {
  assert.deepStrictEqual(dates(byId('policy')), [
    '2026-10-01', '2026-10-29', '2026-11-26', '2026-12-24'
  ]);
});

test('国家安全教育：9-16 周才开课，共 8 次', function () {
  var d = dates(byId('safety'));
  assert.strictEqual(d.length, 8);
  assert.strictEqual(d[0], '2026-11-03'); // 第 9 周周二
});

test('物理学与技术进步：周一 7-8 节 + 周四 9-10 节，9-13/16 周共 12 次', function () {
  assert.strictEqual(dates(byId('phys-tech')).length, 12);
});

test('周课时数对：第 5 周 周一二四各 3 次、周三 4 次、周五 2 次', function () {
  var perWeek = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  // 第 5 周（10 月 5 日那周）所有课都已开、都还没结课
  ['c-lang', 'math', 'chem-lab', 'pe', 'physics', 'ethics', 'english', 'phys-lab', 'chem', 'crime'].forEach(
    function (id) {
      byId(id).slots.forEach(function (s) {
        if (R.slotInWeek(s, 5)) perWeek[s.day]++;
      });
    }
  );
  assert.deepStrictEqual(perWeek, { 1: 3, 2: 3, 3: 4, 4: 3, 5: 2, 6: 0, 7: 0 });
});

/* ---------- 2. 大纲课次 vs 实际上课次数 ---------- */

test('每门课的大纲总课次不超过实际课次数（否则半学期就「讲完了」）', function () {
  var bad = [];
  st.courses.forEach(function (c) {
    var actual = dates(c).length;
    var plan = R.totalSessions(c.outline);
    if (plan > actual || plan < actual - 4) bad.push(c.name + ' 大纲 ' + plan + ' / 实际 ' + actual);
  });
  assert.deepStrictEqual(bad, []);
});

test('每门课的章节顺序 id 不重复', function () {
  var bad = [];
  st.courses.forEach(function (c) {
    var seen = {};
    c.outline.forEach(function (ch) {
      if (seen[ch.id]) bad.push(c.name + ' 重复 ' + ch.id);
      seen[ch.id] = 1;
    });
  });
  assert.deepStrictEqual(bad, []);
});

/* ---------- 3. 拿真实课表跑一遍「今天做什么」 ---------- */

test('第 6 周周四（10 月 15 日）：3 门课，今日必做 3 条且带理由', function () {
  var r = R.buildTasks(st, '2026-10-15');
  assert.strictEqual(r.hasClassToday.length, 3);
  assert.strictEqual(r.top3.length, 3);
  assert.ok(r.all[0].reason && r.all[0].reason.length > 4, '每条任务都要有理由');
});

test('第 9 周周一（11 月 2 日）：物理与技术、化学实验、高数、程序设计都在这天上', function () {
  var r = R.buildTasks(st, '2026-11-02');
  var names = r.hasClassToday.map(function (x) { return x.course.name; }).sort();
  assert.deepStrictEqual(names, ['大学化学实验', '物理学与技术进步', '程序设计(C语言)', '高等数学A(1)']);
});

test('周六没课也不会空手：给顺延或提前量', function () {
  var r = R.buildTasks(Seed.defaultState(), '2026-10-31');
  assert.strictEqual(r.hasClassToday.length, 0);
  assert.ok(r.all.length >= 1, '周末也应有可做的事');
});

test('勾完当天全部任务后，这一天的今日清单清空', function () {
  var s = Seed.defaultState();
  var day = '2026-10-15';
  R.buildTasks(s, day).all.forEach(function (t) { s.done[t.id] = 1; });
  var again = R.buildTasks(s, day).all;
  // 剩下的只可能是别的课还没补的顺延（同一天不会再冒出「今天这门课」的任务）
  again.forEach(function (t) {
    assert.ok(t.kind === 'carry' || t.kind === 'ahead' || t.kind === 'wrapup', '不该再有 ' + t.kind);
  });
});

/* ---------- 4. 进度账 ---------- */

test('第 6 周周五：高数应到 18 次、实到 0、落后 18', function () {
  var s = Seed.defaultState();
  var row = R.courseStats(s, '2026-10-16').filter(function (x) { return x.course.id === 'math'; })[0];
  assert.strictEqual(row.planK, 18);
  assert.strictEqual(row.actual, 0);
  assert.strictEqual(row.behind, 18);
});

console.log('\n通过 ' + pass + '，失败 ' + fail);
if (fail) process.exit(1);

