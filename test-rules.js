/* 规则层单测：node test-rules.js（零依赖，直接用 node:assert） */
'use strict';
var assert = require('assert');
var R = require('./rules.js');
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

function fixture() {
  return {
    version: 1,
    termStart: '2026-09-07', // 周一
    courses: [
      {
        id: 'math',
        name: '高等数学',
        slots: [{ day: 1 }, { day: 3 }],
        outline: [
          { id: 'a', title: '第一章 函数与极限', sessions: 2 },
          { id: 'b', title: '第二章 导数与微分', sessions: 3 }
        ]
      }
    ],
    homework: [],
    done: {}
  };
}

/* ---------------- 日期工具 ---------------- */

test('addDays 跨月', function () {
  assert.strictEqual(R.addDays('2026-09-30', 1), '2026-10-01');
  assert.strictEqual(R.addDays('2026-03-01', -1), '2026-02-28');
});

test('isoWeekday 周一=1 周日=7', function () {
  assert.strictEqual(R.isoWeekday('2026-09-07'), 1);
  assert.strictEqual(R.isoWeekday('2026-09-13'), 7);
});

test('diffDays 方向正确', function () {
  assert.strictEqual(R.diffDays('2026-09-07', '2026-09-09'), 2);
  assert.strictEqual(R.diffDays('2026-09-09', '2026-09-07'), -2);
});

test('termWeek 第几周', function () {
  assert.strictEqual(R.termWeek('2026-09-07', '2026-09-07'), 1);
  assert.strictEqual(R.termWeek('2026-09-07', '2026-09-14'), 2);
  assert.strictEqual(R.termWeek('2026-09-07', '2026-09-13'), 1);
});

/* ---------------- 课表 → 上课日期 ---------------- */

test('courseDatesBefore 只挑课表上的星期', function () {
  var c = fixture().courses[0];
  assert.deepStrictEqual(R.courseDatesBefore(c, '2026-09-07', '2026-09-16'), [
    '2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16'
  ]);
});

test('courseDatesBefore 不越过 until', function () {
  var c = fixture().courses[0];
  assert.deepStrictEqual(R.courseDatesBefore(c, '2026-09-07', '2026-09-10'), [
    '2026-09-07', '2026-09-09'
  ]);
});

test('courseDatesBefore 空课表返回空数组', function () {
  assert.deepStrictEqual(R.courseDatesBefore({ slots: [] }, '2026-09-07', '2026-10-01'), []);
});

test('sessionNoOn 今天有课/没课', function () {
  var c = fixture().courses[0];
  assert.strictEqual(R.sessionNoOn(c, '2026-09-07', '2026-09-09'), 2);
  assert.strictEqual(R.sessionNoOn(c, '2026-09-07', '2026-09-08'), 0);
});

/* ---------------- 大纲 → 章节 ---------------- */

test('chapterAt 落在正确章节', function () {
  var o = fixture().courses[0].outline;
  var r1 = R.chapterAt(o, 1);
  assert.strictEqual(r1.chapter.id, 'a');
  assert.strictEqual(r1.sessionInChapter, 1);
  assert.strictEqual(r1.totalInChapter, 2);

  var r3 = R.chapterAt(o, 3);
  assert.strictEqual(r3.chapter.id, 'b');
  assert.strictEqual(r3.sessionInChapter, 1);

  var r5 = R.chapterAt(o, 5);
  assert.strictEqual(r5.chapter.id, 'b');
  assert.strictEqual(r5.sessionInChapter, 3);
});

test('chapterAt 超出大纲返回 null', function () {
  assert.strictEqual(R.chapterAt(fixture().courses[0].outline, 6), null);
});

test('totalSessions 累加', function () {
  assert.strictEqual(R.totalSessions(fixture().courses[0].outline), 5);
});

/* ---------------- 今日任务生成 ---------------- */

test('今天有课：预习 + 课后 + 顺延，按优先级排序', function () {
  var st = fixture();
  var r = R.buildTasks(st, '2026-09-09'); // 周三，第 2 次课
  assert.strictEqual(r.hasClassToday.length, 1);
  assert.strictEqual(r.hasClassToday[0].k, 2);

  var kinds = r.all.map(function (t) { return t.kind; });
  assert.deepStrictEqual(kinds, ['review-after', 'carry', 'preview']);

  // 课后 > 顺延 > 预习
  assert.ok(r.all[0].prio > r.all[1].prio);
  assert.ok(r.all[1].prio > r.all[2].prio);
  assert.strictEqual(r.top3.length, 3);
  assert.strictEqual(r.doneTop, 0);
});

test('上一次课的复习已勾 → 不再生成顺延', function () {
  var st = fixture();
  st.done['2026-09-07#math#review-after#a'] = 1;
  var r = R.buildTasks(st, '2026-09-09');
  var kinds = r.all.map(function (t) { return t.kind; });
  assert.deepStrictEqual(kinds, ['review-after', 'preview']);
});

test('连欠 2 节课后复习 → 记为逾期并被排到前面', function () {
  var st = fixture();
  var r = R.buildTasks(st, '2026-09-21'); // 第 5 次课，前两节都没勾
  var carry = r.all.filter(function (t) { return t.kind === 'carry'; })[0];
  assert.ok(carry, '应该有一条顺延任务');
  assert.ok(carry.prio === R.PRIO.reviewCarryOverdue, 'prio 应为 90，实际 ' + carry.prio);
  assert.ok(carry.title.indexOf('逾期') >= 0, '标题应含「逾期」，实际 ' + carry.title);
  assert.strictEqual(carry.pendingCount, 4);
  // 顺延逾期(90) 应排在今天课后(60) 前面
  assert.strictEqual(r.all[0].kind, 'carry');
});

test('逾期作业优先级最高，排第一', function () {
  var st = fixture();
  st.homework = [
    { id: 'h1', courseId: 'math', title: '习题 1.4', dueOn: '2026-09-07', estMin: 30 }
  ];
  var r = R.buildTasks(st, '2026-09-09');
  assert.strictEqual(r.all[0].kind, 'hw-overdue');
  assert.strictEqual(r.all[0].prio, R.PRIO.hwOverdue);
  assert.ok(r.all[0].reason.indexOf('逾期') >= 0);
});

test('未来才到期的作业不进今日清单', function () {
  var st = fixture();
  st.homework = [
    { id: 'h2', courseId: 'math', title: '习题 1.5', dueOn: '2026-09-20' }
  ];
  var r = R.buildTasks(st, '2026-09-09');
  assert.strictEqual(r.all.filter(function (t) { return t.kind.indexOf('hw') === 0; }).length, 0);
});

test('已完成的作业不再出现', function () {
  var st = fixture();
  st.homework = [
    { id: 'h3', courseId: 'math', title: '习题 1.6', dueOn: '2026-09-09', done: true }
  ];
  var r = R.buildTasks(st, '2026-09-09');
  assert.strictEqual(r.all.filter(function (t) { return t.kind.indexOf('hw') === 0; }).length, 0);
});

test('没课且无积压 → 给一条提前量，页面不空', function () {
  var st = fixture();
  st.done['2026-09-07#math#review-after#a'] = 1;
  var r = R.buildTasks(st, '2026-09-08'); // 周二没课
  assert.strictEqual(r.hasClassToday.length, 0);
  assert.strictEqual(r.all.length, 1);
  assert.strictEqual(r.all[0].kind, 'ahead');
  assert.ok(r.all[0].reason.indexOf('9月9日') >= 0, '理由应给出下次课日期，实际 ' + r.all[0].reason);
});

test('大纲讲完 → 转总复习任务，不再按课次算章节', function () {
  var st = fixture();
  var r = R.buildTasks(st, '2026-09-28'); // 第 7 次课，超出 5 次大纲
  var wrap = r.all.filter(function (t) { return t.kind === 'wrapup'; })[0];
  assert.ok(wrap, '应有一条总复习任务');
});

test('勾掉之后任务不再出现在列表里', function () {
  var st = fixture();
  var before = R.buildTasks(st, '2026-09-09');
  var id = before.all[0].id;
  st.done[id] = 1;
  var after = R.buildTasks(st, '2026-09-09');
  assert.strictEqual(after.all.filter(function (t) { return t.id === id; }).length, 0);
});

/* ---------------- 进度账 ---------------- */

test('courseStats 统计应到/实到/落后', function () {
  var st = fixture();
  st.done['2026-09-07#math#review-after#a'] = 1;
  var s = R.courseStats(st, '2026-09-09')[0];
  assert.strictEqual(s.planK, 2);
  assert.strictEqual(s.actual, 1);
  assert.strictEqual(s.behind, 1);
  assert.strictEqual(s.limit, 5);
});

test('courseStats 全部勾完 → 无落后', function () {
  var st = fixture();
  st.done['2026-09-07#math#review-after#a'] = 1;
  st.done['2026-09-09#math#review-after#a'] = 1;
  var s = R.courseStats(st, '2026-09-09')[0];
  assert.strictEqual(s.behind, 0);
});

test('upcomingSummary 给出未来 7 天的课', function () {
  var st = fixture();
  var up = R.upcomingSummary(st, '2026-09-08');
  assert.ok(up.length >= 2, '未来 7 天应有至少 2 次课，实际 ' + up.length);
  assert.strictEqual(up[0].date, '2026-09-09');
});

/* ---------------- 周次过滤（真实课表要按 1-8 周 / 9-16 周 / 单双周切断） ---------------- */

test('fromWeek/toWeek：1-8 周的课到第 9 周就该消失', function () {
  var c = { slots: [{ day: 5, fromWeek: 1, toWeek: 8 }] };
  var dates = R.courseDatesBefore(c, '2026-09-07', '2027-01-20');
  assert.strictEqual(dates.length, 8);
  assert.strictEqual(dates[0], '2026-09-11'); // 周五
  assert.strictEqual(dates[7], '2026-10-30'); // 第 8 周周五
  assert.strictEqual(R.sessionNoOn(c, '2026-09-07', '2026-11-06'), 0); // 第 9 周没课
});

test('weeks 指定周次：形势与政策只上 4/8/12/16 周', function () {
  var c = { slots: [{ day: 4, weeks: [4, 8, 12, 16] }] };
  var dates = R.courseDatesBefore(c, '2026-09-07', '2027-01-20');
  assert.deepStrictEqual(dates, ['2026-10-01', '2026-10-29', '2026-11-26', '2026-12-24']);
  assert.strictEqual(R.sessionNoOn(c, '2026-09-07', '2026-10-01'), 1);
  assert.strictEqual(R.sessionNoOn(c, '2026-09-07', '2026-10-08'), 0);
});

test('parity 单双周', function () {
  var c = { slots: [{ day: 3, parity: 'odd' }] };
  var dates = R.courseDatesBefore(c, '2026-09-07', '2026-10-15');
  assert.deepStrictEqual(dates, ['2026-09-09', '2026-09-23', '2026-10-07']); // 第 1/3/5 周
});

test('termStart 不是周一时也能正确按周排', function () {
  var c = { slots: [{ day: 1 }, { day: 3 }] };
  // 2026-09-09 是周三，归一化后第 1 周周一仍是 09-07
  assert.deepStrictEqual(
    R.courseDatesBefore(c, '2026-09-09', '2026-09-16'),
    ['2026-09-09', '2026-09-14', '2026-09-16']
  );
});

/* ---------------- 复习起点（ignoredBefore）与「下一次课」 ---------------- */

function longFixture() {
  return {
    version: 1,
    termStart: '2026-09-07', // 周一
    courses: [{
      id: 'math',
      name: '高等数学',
      slots: [{ day: 1 }, { day: 3 }],
      outline: [{ id: 'a', title: '第一章 函数与极限', sessions: 20 }]
    }],
    homework: [],
    done: {}
  };
}

test('没有起点设置时，没勾的历史课次会变成顺延任务', function () {
  var r = R.buildTasks(longFixture(), '2026-10-14');
  var carry = r.all.filter(function (t) { return t.kind === R.KIND.CARRY; });
  assert.strictEqual(carry.length, 1, '应该有 1 条顺延');
});

test('ignoredBefore：起点之前的课次不再算欠账', function () {
  var s = longFixture();
  s.ignoredBefore = '2026-10-14';
  var r = R.buildTasks(s, '2026-10-14');
  assert.strictEqual(r.all.filter(function (t) { return t.kind === R.KIND.CARRY; }).length, 0);
});

test('ignoredBefore 不影响当天的课后复习', function () {
  var s = longFixture();
  s.ignoredBefore = '2026-10-14';
  var r = R.buildTasks(s, '2026-10-14');
  assert.ok(r.all.some(function (t) { return t.kind === R.KIND.REVIEW; }), '当天课后复习必须保留');
});

test('起点之后重新累计：再过一周，两节课没勾又算欠', function () {
  var s = longFixture();
  s.ignoredBefore = '2026-10-14';
  var carry = R.buildTasks(s, '2026-10-21').all.filter(function (t) { return t.kind === R.KIND.CARRY; });
  assert.strictEqual(carry.length, 1);
  assert.strictEqual(carry[0].pendingCount, 2);
});

test('nextSessionAfter 只取今天之后的课，不返回今天', function () {
  var n = R.nextSessionAfter(longFixture(), '2026-10-14'); // 这天周三有课
  assert.ok(n, '应该能找到下一节课');
  assert.strictEqual(n.date, '2026-10-19');
  assert.strictEqual(n.k, 13);
});

test('复习起点后，应到只从起点算，章节定位仍按真实课次', function () {
  var s = longFixture();
  s.ignoredBefore = '2026-10-14';
  var t = R.courseStats(s, '2026-10-14')[0];
  assert.strictEqual(t.skipped, 11, '起点前 11 次');
  assert.strictEqual(t.planK, 1, '只算当天这 1 次');
  assert.strictEqual(t.behind, 1, '当天还没勾 → 落后 1');
  assert.ok(t.nowChapter, '章节定位不受起点影响');
});

/* ---------------- 作业台账（今日页「作业」区） ---------------- */

function hwState(items) {
  return {
    courses: [
      { id: 'c-lang', name: '程序设计(C语言)', color: '#1f5fa8' },
      { id: 'math', name: '高等数学A(1)', color: '#b5342a' },
      { id: 'chem', name: '大学化学', color: '#2f6b4f' }
    ],
    homework: items
  };
}

test('作业台账：按截止时间从早到晚排', function () {
  var s = hwState([
    { id: 'b', courseId: 'math', title: 'B', dueOn: '2026-10-26' },
    { id: 'a', courseId: 'c-lang', title: 'A', dueOn: '2026-10-15' },
    { id: 'c', courseId: 'chem', title: 'C', dueOn: '2026-10-19' }
  ]);
  var l = R.homeworkList(s, '2026-10-19');
  assert.strictEqual(l.length, 3);
  assert.deepStrictEqual(l.map(function (x) { return x.hw.id; }), ['a', 'c', 'b']);
});

test('作业台账：逾期/今天/还没到 三种状态与天数', function () {
  var s = hwState([
    { id: 'a', courseId: 'math', title: 'A', dueOn: '2026-10-16' },
    { id: 'b', courseId: 'math', title: 'B', dueOn: '2026-10-19' },
    { id: 'c', courseId: 'math', title: 'C', dueOn: '2026-10-22' }
  ]);
  var l = R.homeworkList(s, '2026-10-19');
  assert.strictEqual(l[0].state, 'overdue');
  assert.strictEqual(l[0].daysLeft, 3);
  assert.strictEqual(l[1].state, 'today');
  assert.strictEqual(l[1].daysLeft, 0);
  assert.strictEqual(l[2].state, 'later');
  assert.strictEqual(l[2].daysLeft, -3);
});

test('作业台账：做掉的、没填截止日的不出现', function () {
  var s = hwState([
    { id: 'a', courseId: 'math', title: 'A', dueOn: '2026-10-20' },
    { id: 'b', courseId: 'math', title: 'B', dueOn: '2026-10-20', done: true },
    { id: 'c', courseId: 'math', title: 'C', dueOn: '2026-10-20', doneOn: '2026-10-18' },
    { id: 'd', courseId: 'math', title: 'D', dueOn: '' }
  ]);
  var l = R.homeworkList(s, '2026-10-19');
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].hw.id, 'a');
});

test('作业台账：认不出课程也能显示（落到「其他」）', function () {
  var s = hwState([{ id: 'a', courseId: 'nope', title: 'A', dueOn: '2026-10-20' }]);
  var l = R.homeworkList(s, '2026-10-19');
  assert.strictEqual(l[0].courseName, '其他');
});

test('作业台账：同一天截止的顺序稳定', function () {
  var s = hwState([
    { id: 'x2', courseId: 'math', title: 'X2', dueOn: '2026-10-20' },
    { id: 'x1', courseId: 'c-lang', title: 'X1', dueOn: '2026-10-20' }
  ]);
  var a = R.homeworkList(s, '2026-10-19').map(function (x) { return x.hw.id; });
  var b = R.homeworkList(s, '2026-10-19').map(function (x) { return x.hw.id; });
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(a, ['x1', 'x2']);
});

/* ---------------- 简单版今日清单 dailyList ---------------- */

test('dailyList：今天有 3 门课 → 英语 1 条 + 每门 2 条', function () {
  var s = Seed.defaultState();
  var r = R.dailyList(s, '2026-10-19');
  assert.strictEqual(r.courses.length, 3);
  assert.strictEqual(r.list.length, 7);
  assert.strictEqual(r.list[0].kind, 'en');           // 英语永远排第一
  assert.deepStrictEqual(r.list.map(function (t) { return t.kind; }),
    ['en', 'pre', 'rev', 'pre', 'rev', 'pre', 'rev']);
});

test('dailyList：按上课节次从前到后，不是按课程名字母', function () {
  var s = Seed.defaultState();
  var r = R.dailyList(s, '2026-10-19');
  assert.deepStrictEqual(
    r.list.filter(function (t) { return t.kind === 'pre'; }).map(function (t) { return t.courseName; }),
    ['程序设计(C语言)', '高等数学A(1)', '大学化学实验']);
});

test('dailyList：当天本身有英语课 → 不再重复加那条固定英语', function () {
  var s = Seed.defaultState();
  var r = R.dailyList(s, '2026-10-21');   // 周三有 大学英语C(1)
  assert.strictEqual(r.hasEnglish, true);
  assert.deepStrictEqual(r.list.filter(function (t) { return t.kind === 'en'; }).length, 0);
  assert.strictEqual(r.list.filter(function (t) { return t.courseId === 'english'; }).length, 2);
});

test('dailyList：周末没课，只剩英语这一条', function () {
  var s = Seed.defaultState();
  var r = R.dailyList(s, '2026-10-24');   // 周六
  assert.strictEqual(r.courses.length, 0);
  assert.strictEqual(r.list.length, 1);
  assert.strictEqual(r.list[0].kind, 'en');
});

test('dailyList：勾掉的不再出现，且不同天互不影响', function () {
  var s = Seed.defaultState();
  var one = R.dailyList(s, '2026-10-19');
  s.done[one.list[1].id] = 1;             // 勾掉周一的「课前预习：程序设计」
  var after = R.dailyList(s, '2026-10-19');
  assert.strictEqual(after.list.length, 6);
  assert.strictEqual(after.list.some(function (t) { return t.id === one.list[1].id; }), false);
  assert.strictEqual(R.dailyList(s, '2026-10-20').list.length, 7);
});

test('dailyList：任务标题里不带章节名和分钟数', function () {
  var s = Seed.defaultState();
  R.dailyList(s, '2026-10-19').all.forEach(function (t) {
    assert.strictEqual(/第[\d一二三四五六七八九十]+章/.test(t.title), false);
    assert.strictEqual(/分钟/.test(t.title), false);
    assert.strictEqual(t.estMin, undefined);
  });
});

/* ---------------- 作业台账：具体几点、还剩几小时 ---------------- */

test('homeworkList 同一天按时间排，没写时间的排最后', function () {
  var s = fixture();
  s.homework = [
    { id: 'x', courseId: 'math', title: '晚', dueOn: '2026-10-19', dueTime: '20:00' },
    { id: 'y', courseId: 'math', title: '早', dueOn: '2026-10-19', dueTime: '09:00' },
    { id: 'z', courseId: 'math', title: '没写时间', dueOn: '2026-10-19' }
  ];
  var ids = R.homeworkList(s, '2026-10-19', '2026-10-19T14:00:00').map(function (x) { return x.hw.id; });
  assert.deepStrictEqual(ids, ['y', 'x', 'z']);
});

test('homeworkList 今天到期且写了时间 → 算出还剩几小时', function () {
  var s = fixture();
  s.homework = [{ id: 'a', courseId: 'math', title: '作文', dueOn: '2026-10-19', dueTime: '20:30' }];
  var x = R.homeworkList(s, '2026-10-19', '2026-10-19T18:00:00')[0];
  assert.strictEqual(x.dueTime, '20:30');
  assert.strictEqual(x.hoursLeft, 2.5);
  var late = R.homeworkList(s, '2026-10-19', '2026-10-19T22:00:00')[0];
  assert.ok(late.hoursLeft < 0, '过了点应该算负数');
});

/* ---------------- 没做完的：留 3 天 ---------------- */

test('dailyList：昨天没勾的进「没做完」，还剩 2 天', function () {
  var s = Seed.defaultState();
  var l = R.dailyList(s, '2026-10-19');
  assert.ok(l.carry.length > 0, '应该带上昨天和前天的未完成项');
  l.carry.forEach(function (t) {
    assert.ok(t.daysLeft >= 1 && t.daysLeft <= 2, '剩余天数应在 1~2：' + t.daysLeft);
    assert.ok(t.carryFrom === '2026-10-18' || t.carryFrom === '2026-10-17', t.carryFrom);
  });
  var oldest = l.carry[0];
  assert.strictEqual(oldest.carryFrom, '2026-10-17', '越老越靠前');
  assert.strictEqual(oldest.daysLeft, 1);
});

test('dailyList：勾掉之后就不再出现在「没做完」里', function () {
  var s = Seed.defaultState();
  var before = R.dailyList(s, '2026-10-19').carry.length;
  var first = R.dailyList(s, '2026-10-19').carry[0];
  s.done[first.id] = 1;
  var after = R.dailyList(s, '2026-10-19').carry.length;
  assert.strictEqual(after, before - 1);
});

test('dailyList：第 4 天就自己消失，不会越积越多', function () {
  var s = Seed.defaultState();
  var l = R.dailyList(s, '2026-10-19');
  var ids = l.carry.map(function (t) { return t.id; });
  ids.forEach(function (id) {
    assert.strictEqual(/^2026-10-1[78]#/.test(id), true, '只该有昨天和前天的：' + id);
  });
  /* 10-16 的任务不在任何日期里 */
  assert.strictEqual(ids.some(function (id) { return id.indexOf('2026-10-16#') === 0; }), false);
});

/* ---------------- 到期提醒：dueSoon 窗口 ---------------- */

function soonFixture() {
  var s = fixture();
  var today = '2026-10-21';
  function add(id, dueOn, dueTime, extra) {
    var o = { id: id, courseId: 'math', title: id, dueOn: dueOn };
    if (dueTime) o.dueTime = dueTime;
    if (extra) for (var k in extra) o[k] = extra[k];
    s.homework.push(o);
  }
  add('过点1h', today, '19:40');
  add('1小时后', today, '21:40');
  add('4小时后', '2026-10-22', '00:40');
  add('明天上午', '2026-10-22', '10:00');
  add('后天', '2026-10-23', '10:00');
  add('今天没几点', today);
  add('三天前逾期', '2026-10-18', '10:00');
  add('已完成', today, '21:00', { doneOn: today });
  return s;
}

test('dueSoon：1 小时窗口只喊「马上到」和「刚过点」', function () {
  var s = soonFixture();
  var names = R.dueSoon(s, '2026-10-21', '2026-10-21T20:40:00', 1).map(function (x) { return x.hw.title; });
  assert.strictEqual(names.indexOf('1小时后') >= 0, true, names.join(','));
  assert.strictEqual(names.indexOf('过点1h') >= 0, true, '刚过点也要喊：' + names.join(','));
  assert.strictEqual(names.indexOf('4小时后') >= 0, false);
  assert.strictEqual(names.indexOf('明天上午') >= 0, false);
});

test('dueSoon：24 小时窗口含明天上午，但不含后天/老逾期/已做完', function () {
  var s = soonFixture();
  var names = R.dueSoon(s, '2026-10-21', '2026-10-21T20:40:00', 24).map(function (x) { return x.hw.title; });
  assert.strictEqual(names.indexOf('明天上午') >= 0, true, names.join(','));
  assert.strictEqual(names.indexOf('后天') >= 0, false);
  assert.strictEqual(names.indexOf('三天前逾期') >= 0, false);
  assert.strictEqual(names.indexOf('已完成') >= 0, false);
});

test('dueSoon：没写几点的只在「今天到期」时才喊', function () {
  var s = soonFixture();
  var names = R.dueSoon(s, '2026-10-21', '2026-10-21T20:40:00', 24).map(function (x) { return x.hw.title; });
  assert.strictEqual(names.indexOf('今天没几点') >= 0, true);
});

test('dueSoon：窗口参数非法时回退 24 小时，不抛错', function () {
  var s = soonFixture();
  assert.ok(R.dueSoon(s, '2026-10-21', '2026-10-21T20:40:00', 0).length >= 1);
  assert.ok(R.dueSoon(s, '2026-10-21', '2026-10-21T20:40:00', 'x').length >= 1);
});

/* ---------------- 汇总 ---------------- */

console.log('\n通过 ' + pass + '，失败 ' + fail);
if (fail) {
  console.log('\n失败明细：');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
