/* 今日任务决策器 · 规则层
 * 纯函数，不碰 DOM，可直接在 Node 里单测：node test-rules.js
 *
 * 核心思路：不靠人工维护「学到哪了」，而是由
 *   学期起始日 + 每周课表 → 推算今天这门课是第几次课
 *   大纲（每章占几次课） → 算出这次课该讲哪一节
 * 人在界面上只做一件事：勾掉「今天做完了」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MS_DAY = 86400000;
  var WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'];
  var MAX_WEEKS = 30; // 一学期 30 周保护上限

  /* ---------- 日期工具 ---------- */

  function toDate(iso) {
    var p = String(iso).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function toISO(dt) {
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, '0');
    var d = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function addDays(iso, n) {
    var dt = toDate(iso);
    dt.setDate(dt.getDate() + n);
    return toISO(dt);
  }

  /** 周一 = 1 … 周日 = 7 */
  function isoWeekday(iso) {
    return ((toDate(iso).getDay() + 6) % 7) + 1;
  }

  /** from 到 to 相差几天；to 晚于 from 为正 */
  function diffDays(from, to) {
    return Math.round((toDate(to) - toDate(from)) / MS_DAY);
  }

  function weekdayCN(iso) {
    return '周' + WEEK_CN[isoWeekday(iso) - 1];
  }

  function fmtCN(iso) {
    var dt = toDate(iso);
    return (dt.getMonth() + 1) + '月' + dt.getDate() + '日 ' + weekdayCN(iso);
  }

  /** 学期第几周（第 1 周从 termStart 所在周算起） */
  function termWeek(termStart, iso) {
    var base = toDate(termStart);
    var startMonday = addDays(termStart, 1 - isoWeekday(termStart));
    return Math.floor(diffDays(startMonday, iso) / 7) + 1;
  }

  /* ---------- 课表 → 上课日期 ---------- */

  /** 学期第 1 周的周一（termStart 不是周一也归一到周一） */
  function termMonday(termStart) {
    return addDays(termStart, 1 - isoWeekday(termStart));
  }

  /**
   * slot 在第 w 周是否上课。三种写法，优先级从高到低：
   *   weeks: [4, 8, 12, 16]    指定周次（形政这类）
   *   fromWeek / toWeek        [4, 16] 区间
   *   parity: 'odd' | 'even'   单双周
   * 都没写 = 每周都上。
   */
  function slotInWeek(slot, w) {
    if (slot.weeks && slot.weeks.length) return slot.weeks.indexOf(w) >= 0;
    var from = slot.fromWeek == null ? 1 : Number(slot.fromWeek);
    var to = slot.toWeek == null ? MAX_WEEKS : Number(slot.toWeek);
    if (w < from || w > to) return false;
    if (slot.parity === 'odd' && w % 2 === 0) return false;
    if (slot.parity === 'even' && w % 2 === 1) return false;
    return true;
  }

  /**
   * 某门课在 [termStart, until] 之间的所有上课日期（升序）。
   * slots: [{ day: 1..7, period: '第1-2节', weeks | fromWeek/toWeek | parity }]
   * 同一天有多个 slot 只算一次。周次过滤在日期层完成，
   * 所以「第几次课」天然只数真正上的课（1-8 周的课不会把 9 周后的课次算进来）。
   */
  function courseDatesBefore(course, termStart, until) {
    var slots = course && course.slots ? course.slots : [];
    var byDay = {};
    slots.forEach(function (s) {
      var d = Number(s.day);
      if (!(d >= 1 && d <= 7)) return;
      (byDay[d] = byDay[d] || []).push(s);
    });
    var days = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; });
    var out = [];
    if (!days.length || !termStart) return out;
    var m0 = termMonday(termStart);

    for (var w = 1; w <= MAX_WEEKS; w++) {
      for (var i = 0; i < days.length; i++) {
        var d = addDays(m0, (w - 1) * 7 + (days[i] - 1));
        if (d > until) return out;
        if (d < termStart) continue; // 开学日之前的那半周不算
        if (byDay[days[i]].some(function (s) { return slotInWeek(s, w); })) out.push(d);
      }
    }
    return out;
  }

  /** 今天这门课是第几次课；今天没课返回 0 */
  function sessionNoOn(course, termStart, today) {
    var dates = courseDatesBefore(course, termStart, today);
    var i = dates.lastIndexOf(today);
    return i < 0 ? 0 : i + 1;
  }

  /* ---------- 大纲 → 章节 ---------- */

  function totalSessions(outline) {
    return (outline || []).reduce(function (a, c) {
      return a + Math.max(1, Number(c.sessions) || 1);
    }, 0);
  }

  /**
   * 第 k 次课（1 起）对应哪一章。
   * 返回 { chapter, index, sessionInChapter, totalInChapter } 或 null（超出大纲）。
   */
  function chapterAt(outline, k) {
    var acc = 0;
    outline = outline || [];
    for (var i = 0; i < outline.length; i++) {
      var n = Math.max(1, Number(outline[i].sessions) || 1);
      if (k <= acc + n) {
        return {
          chapter: outline[i],
          index: i,
          sessionInChapter: k - acc,
          totalInChapter: n
        };
      }
      acc += n;
    }
    return null;
  }

  /* ---------- 今日任务生成 ---------- */

  var KIND = {
    HW_OVERDUE: 'hw-overdue',
    HW_DUE: 'hw-due',
    REVIEW: 'review-after',
    CARRY: 'carry',
    PREVIEW: 'preview',
    AHEAD: 'ahead',
    WRAP: 'wrapup'
  };

  // 优先级：逾期 > 今天课后 > 顺延 > 预习
  var PRIO = {
    hwOverdue: 100,
    reviewCarryOverdue: 90,
    hwDue: 80,
    reviewToday: 60,
    carry: 40,
    preview: 30,
    ahead: 10,
    wrap: 20
  };

  function taskKeyDone(state, id) {
    return !!(state.done && state.done[id]);
  }

  /**
   * 生成某一天的任务。
   * state: { termStart, courses: [{id,name,color,slots,outline:[{id,title,sessions}]}], homework: [], done: {} }
   * 返回 { date, hasClassToday: [{course, k, chapter}], all: [], top3: [], doneTop: n }
   */
  function buildTasks(state, today) {
    state = state || {};
    var courses = state.courses || [];
    var all = [];
    var hasClassToday = [];

    function push(t) {
      if (taskKeyDone(state, t.id)) return;
      all.push(t);
    }

    /* 1. 作业：到期或逾期才进今日清单 */
    (state.homework || []).forEach(function (hw) {
      if (hw.done) return;
      if (!hw.dueOn) return;
      var late = diffDays(hw.dueOn, today); // >0 逾期，0 今天到期
      if (late < 0) return;
      var course = null;
      for (var i = 0; i < courses.length; i++) {
        if (courses[i].id === hw.courseId) { course = courses[i]; break; }
      }
      push({
        id: today + '#hw-' + hw.id,
        kind: late > 0 ? KIND.HW_OVERDUE : KIND.HW_DUE,
        courseId: hw.courseId,
        courseName: course ? course.name : '作业',
        title: '交作业：' + hw.title,
        reason: late > 0 ? '已逾期 ' + late + ' 天' : '今天到期',
        estMin: Number(hw.estMin) || 30,
        prio: late > 0 ? PRIO.hwOverdue : PRIO.hwDue
      });
    });

    /* 2. 每门课：今天有课 → 预习 + 课后；上次课没复习 → 顺延 */
    courses.forEach(function (course) {
      var outline = course.outline || [];
      var dates = courseDatesBefore(course, state.termStart, today);
      var k = dates.length && dates[dates.length - 1] === today ? dates.length : 0;
      var isToday = k > 0;

      if (isToday) {
        var ch = chapterAt(outline, k);
        if (ch) {
          hasClassToday.push({ course: course, k: k, chapter: ch });
          push({
            id: today + '#' + course.id + '#preview#' + ch.chapter.id,
            kind: KIND.PREVIEW,
            courseId: course.id,
            courseName: course.name,
            title: '课前预习：' + ch.chapter.title,
            reason: '今天第 ' + k + ' 次课讲这里（第 ' + ch.sessionInChapter + '/' + ch.totalInChapter + ' 次），先扫一遍目录和例题',
            estMin: 15,
            prio: PRIO.preview
          });
          push({
            id: today + '#' + course.id + '#review-after#' + ch.chapter.id,
            kind: KIND.REVIEW,
            courseId: course.id,
            courseName: course.name,
            title: '课后当天：' + ch.chapter.title + ' 例题 2–3 道',
            reason: '今天这门课刚讲完，趁热做一遍比明天做省一半时间',
            estMin: 40,
            prio: PRIO.reviewToday
          });
        } else {
          push({
            id: today + '#' + course.id + '#wrap',
            kind: KIND.WRAP,
            courseId: course.id,
            courseName: course.name,
            title: course.name + '：大纲已讲完，做一套综合题 / 翻错题本',
            reason: '第 ' + k + ' 次课已超出大纲课次，进入总复习',
            estMin: 45,
            prio: PRIO.wrap
          });
        }
      }

      /* 往回找「没补的课后复习」：连欠 ≥2 节、或最老的一节超过 7 天 → 记逾期 */
      var prevK = isToday ? k - 1 : dates.length;
      var pending = [];
      var floor = state.ignoredBefore || '';
      for (var j = prevK; j >= 1 && pending.length < 4; j--) {
        var pdate = dates[j - 1];
        if (floor && pdate < floor) break; // 点了「从今天开始记」：此前的课次不算欠账
        if (diffDays(pdate, today) > 21) break;
        var pch = chapterAt(outline, j);
        if (!pch) break;
        if (taskKeyDone(state, pdate + '#' + course.id + '#review-after#' + pch.chapter.id)) break;
        pending.push({ date: pdate, k: j, chapter: pch });
      }
      if (pending.length) {
        var oldest = pending[pending.length - 1];
        var gap = diffDays(oldest.date, today);
        var overdue = pending.length >= 2 || gap > 7;
        push({
          id: today + '#' + course.id + '#carry#' + oldest.chapter.chapter.id,
          kind: KIND.CARRY,
          courseId: course.id,
          courseName: course.name,
          title:
            (overdue ? '补上逾期复习：' : '补上：') +
            oldest.chapter.chapter.title +
            (pending.length > 1 ? ' 等 ' + pending.length + ' 节' : ''),
          reason: overdue
            ? '欠了 ' + pending.length + ' 节课后复习，最老的一节是 ' + oldest.date + '（' + gap + ' 天前）'
            : oldest.date + ' 那节课的复习还没勾，已顺延 ' + gap + ' 天',
          estMin: 30 + (pending.length - 1) * 10,
          prio: overdue ? PRIO.reviewCarryOverdue : PRIO.carry,
          overdueDays: overdue ? gap : 0,
          pendingCount: pending.length
        });
      }
    });

    /* 3. 什么都没排 → 给一条「提前量」，而不是让页面空着 */
    if (!all.length) {
      var next = nextSessionAfter(state, today);
      if (next && next.chapter) {
        push({
          id: today + '#' + next.course.id + '#ahead#' + next.chapter.chapter.id,
          kind: KIND.AHEAD,
          courseId: next.course.id,
          courseName: next.course.name,
          title: '提前量：预习 ' + next.chapter.chapter.title,
          reason: '今天没课也没有积压，' + fmtCN(next.date) + ' 的第 ' + next.k + ' 次课会讲这里',
          estMin: 20,
          prio: PRIO.ahead
        });
      }
    }

    all.sort(function (a, b) {
      if (b.prio !== a.prio) return b.prio - a.prio;
      if (a.estMin !== b.estMin) return a.estMin - b.estMin;
      return a.courseName < b.courseName ? -1 : 1;
    });

    var top3 = all.slice(0, 3);
    return {
      date: today,
      hasClassToday: hasClassToday,
      all: all,
      top3: top3,
      doneTop: top3.filter(function (t) { return taskKeyDone(state, t.id); }).length
    };
  }

  /** 今天之后最近的一次课（用于空列表时给提前量） */
  function nextSessionAfter(state, today) {
    var best = null;
    (state.courses || []).forEach(function (course) {
      var outline = course.outline || [];
      var limit = totalSessions(outline);
      var dates = courseDatesBefore(course, state.termStart, addDays(today, 30));
      for (var i = 0; i < dates.length; i++) {
        var d = dates[i];
        if (d <= today) continue; // 只要「今天之后」，今天的课在「今天的课」里已单列
        var k = i + 1;
        if (k > limit) break;
        var ch = chapterAt(outline, k);
        if (!ch) break;
        var slot = null;
        (course.slots || []).forEach(function (s) {
          if (s.day === isoWeekday(d)) slot = s;
        });
        if (!best || d < best.date) {
          best = { course: course, date: d, k: k, chapter: ch, period: slot ? slot.period : '' };
        }
        break;
      }
    });
    return best;
  }

  /* ---------- 进度账 ---------- */

  /** 每门课：按课表应到第几次 / 实际勾掉几次 / 落后几次 / 当前章节 */
  function courseStats(state, today) {
    return (state.courses || []).map(function (course) {
      var outline = course.outline || [];
      var dates = courseDatesBefore(course, state.termStart, today);
      var heldK = dates.length; // 真实已上课次数，也就是「第 k 次课」的 k
      var floor = state.ignoredBefore || '';
      var from = 0;
      while (from < dates.length && floor && dates[from] < floor) from++; // 起点前的课次不计入「应到」
      var planK = dates.length - from;
      var actual = 0;
      for (var i = from; i < dates.length; i++) {
        var d = dates[i];
        var ch = chapterAt(outline, i + 1);
        if (ch && taskKeyDone(state, d + '#' + course.id + '#review-after#' + ch.chapter.id)) actual++;
      }
      var limit = totalSessions(outline);
      return {
        course: course,
        planK: planK,
        actual: actual,
        skipped: from,
        behind: Math.max(0, planK - actual),
        nowChapter: chapterAt(outline, Math.min(Math.max(heldK, 1), Math.max(limit, 1))),
        limit: limit,
        finished: limit > 0 && heldK >= limit
      };
    });
  }

  /** 今天之后 7 天里有几次课（用于顶部提示） */
  function upcomingSummary(state, today) {
    var out = [];
    for (var i = 1; i <= 7; i++) {
      var d = addDays(today, i);
      (state.courses || []).forEach(function (course) {
        if (courseDatesBefore(course, state.termStart, d).slice(-1)[0] === d) {
          out.push({ date: d, course: course });
        }
      });
    }
    return out;
  }

  /**
   * 作业台账：没做完的作业按截止时间从早到晚排，给今日页「作业」区用。
   * 返回 [{ hw, courseId, courseName, color, dueOn, daysLeft, state }]
   *   daysLeft > 0 逾期 / = 0 今天到期 / < 0 还没到
   */
  function homeworkList(state, today) {
    var courses = state.courses || [];
    var byId = {};
    courses.forEach(function (c) { byId[c.id] = c; });
    var list = (state.homework || []).filter(function (hw) {
      return hw && hw.dueOn && !hw.done && !hw.doneOn;
    });
    list.sort(function (a, b) {
      if (a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
      var an = (byId[a.courseId] || {}).name || '';
      var bn = (byId[b.courseId] || {}).name || '';
      if (an !== bn) return an < bn ? -1 : 1;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    return list.map(function (hw) {
      var c = byId[hw.courseId] || null;
      var days = diffDays(hw.dueOn, today);   // >0 逾期，0 今天到期，<0 还没到
      return {
        hw: hw,
        courseId: hw.courseId,
        courseName: c ? c.name : (hw.courseName || '其他'),
        color: (c && c.color) || '#888',
        dueOn: hw.dueOn,
        daysLeft: days,
        state: days > 0 ? 'overdue' : days === 0 ? 'today' : 'later'
      };
    });
  }

  /* ---------------- 简单版今日清单 ----------------
     只要两件事：今天有课的那几门 → 课前预习 + 课后复习；
     英语每天都有一条（当天本身有英语课时，用它的预习/复习顶上，不重复加）。
     不写章节、不写第几次课、不算分钟、不计积压——一眼能看完，勾起来快。 */

  function periodNo(period) {
    var m = /(\d+)/.exec(String(period || ''));
    return m ? Number(m[1]) : 99;
  }

  function todayCourseList(state, today) {
    var courses = (state && state.courses) || [];
    var out = [];
    courses.forEach(function (course) {
      var dates = courseDatesBefore(course, state.termStart, today);
      if (!dates.length || dates[dates.length - 1] !== today) return;
      var slot = null;
      (course.slots || []).forEach(function (s) {
        if (s.day === isoWeekday(today)) slot = s;
      });
      var period = slot ? slot.period : '';
      out.push({ course: course, period: period, no: periodNo(period) });
    });
    out.sort(function (a, b) {
      if (a.no !== b.no) return a.no - b.no;
      return a.course.name < b.course.name ? -1 : 1;
    });
    return out;
  }

  function dailyList(state, today) {
    state = state || {};
    var done = state.done || {};
    var list = [];
    var todays = todayCourseList(state, today);
    var hasEnglish = false;

    todays.forEach(function (x) {
      var c = x.course;
      if (c.id === 'english') hasEnglish = true;
      var when = x.period ? ('今天 ' + x.period + ' 上课') : '今天有课';
      list.push({
        id: today + '#' + c.id + '#pre',
        kind: 'pre',
        courseId: c.id,
        courseName: c.name,
        title: '课前预习：' + c.name,
        reason: when + '，课前把上次讲的扫一遍，今天要讲的地方先看个眼熟',
        period: x.period,
        prio: 10
      });
      list.push({
        id: today + '#' + c.id + '#rev',
        kind: 'rev',
        courseId: c.id,
        courseName: c.name,
        title: '课后复习：' + c.name,
        reason: '上完当天趁热过一遍，比隔天再捡省一半时间',
        period: x.period,
        prio: 20
      });
    });

    if (!hasEnglish) {
      list.unshift({
        id: today + '#english#daily',
        kind: 'en',
        courseId: 'english',
        courseName: '英语',
        title: '英语：背单词 + 读一段',
        reason: '每天都做，不跟课表走',
        period: '',
        prio: 15
      });
    }

    return {
      list: list.filter(function (t) { return !done[t.id]; }),
      all: list,
      courses: todays,
      hasEnglish: hasEnglish
    };
  }

  return {
    KIND: KIND,
    PRIO: PRIO,
    dailyList: dailyList,
    todayCourseList: todayCourseList,
    toDate: toDate,
    toISO: toISO,
    addDays: addDays,
    isoWeekday: isoWeekday,
    diffDays: diffDays,
    weekdayCN: weekdayCN,
    fmtCN: fmtCN,
    termWeek: termWeek,
    termMonday: termMonday,
    slotInWeek: slotInWeek,
    courseDatesBefore: courseDatesBefore,
    sessionNoOn: sessionNoOn,
    totalSessions: totalSessions,
    chapterAt: chapterAt,
    buildTasks: buildTasks,
    homeworkList: homeworkList,
    nextSessionAfter: nextSessionAfter,
    courseStats: courseStats,
    upcomingSummary: upcomingSummary
  };
});
