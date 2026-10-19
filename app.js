/* 今日任务决策器 · 界面层
 * 只做三件事：把 rules.js 算出来的任务画出来 / 把勾选写回 localStorage / 让课表和开学日可改。
 */
(function () {
  'use strict';

  var R = window.Rules;
  var Seed = window.Seed;
  var KEY = 'today.state.v1';

  var state = load();
  var tab = (function () {
    var h = (location.hash || '').replace('#', '');
    return h === 'progress' || h === 'settings' ? h : 'today';
  })();
  var viewDate = (function () {
    var m = /[?&]d=(\d{4}-\d{2}-\d{2})/.exec(location.search);
    return R && m ? m[1] : R.toISO(stateNow());
  })();

  /* ---------------- 存取 ---------------- */

  function stateNow() {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.courses && s.courses.length) return normalize(s);
      }
    } catch (e) {
      console.warn('读取本地数据失败，用课表种子数据', e);
    }
    return Seed.defaultState();
  }

  function normalize(s) {
    s.version = s.version || 1;
    s.termStart = s.termStart || Seed.TERM_START;
    s.courses = s.courses || [];
    s.homework = s.homework || [];
    s.done = s.done || {};
    s.ignoredBefore = s.ignoredBefore || '';
    return s;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast('本地保存失败：' + (e && e.message ? e.message : e));
    }
  }

  /* ---------------- 小工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('on'); }, 1900);
  }

  function courseOf(id) {
    var out = null;
    state.courses.forEach(function (c) { if (c.id === id) out = c; });
    return out;
  }

  /** 今天这门课在第几节、在哪上 */
  function slotToday(course, iso) {
    var w = R.termWeek(state.termStart, iso);
    var day = R.isoWeekday(iso);
    var hit = null;
    (course.slots || []).forEach(function (s) {
      if (Number(s.day) === day && R.slotInWeek(s, w)) hit = s;
    });
    return hit;
  }

  function weekLabel(iso) {
    var w = R.termWeek(state.termStart, iso);
    if (w < 1) return '开学前 ' + -w + ' 周';
    if (w > 30) return '已过学期';
    return '第 ' + w + ' 周';
  }

  var KIND_LABEL = {
    'hw-overdue': '逾期作业', 'hw-due': '今天截止', 'review-after': '课后当天',
    carry: '顺延补做', preview: '课前预习', ahead: '提前量', wrapup: '总复习'
  };

  /* ---------------- 顶栏 ---------------- */

  function renderHeader() {
    $('#hdrDate').innerHTML =
      esc(R.fmtCN(viewDate).split(' ')[0]) + '<span class="wd">' + esc(R.weekdayCN(viewDate)) + '</span>';
    var w = weekLabel(viewDate);
    var same = viewDate === R.toISO(stateNow());
    $('#hdrSub').innerHTML =
      (same ? '今天 · ' : '') + '<b>' + esc(w) + '</b> · ' +
      esc(Seed.META.term) + (viewDate === R.toISO(stateNow()) ? '' : ' · <span style="color:var(--red)">非今天</span>');
    document.title = (same ? '今天' : R.fmtCN(viewDate)) + ' · 今天做什么';
  }

  /* ---------------- 今日 ---------------- */

  function taskHTML(t, rank) {
    var done = !!state.done[t.id];
    var tagClass = t.prio >= 100 ? 'hot' : t.prio >= 60 ? 'warm' : '';
    var meta = [];
    meta.push('<span class="tag ' + tagClass + '">' + esc(KIND_LABEL[t.kind] || t.kind) + '</span>');
    meta.push('<span>' + esc(t.courseName) + '</span>');
    if (t.estMin) meta.push('<span>约 ' + t.estMin + ' 分钟</span>');
    return '' +
      '<div class="todo' + (done ? ' done' : '') + '" data-id="' + esc(t.id) + '">' +
        (rank ? '<div class="rank">' + rank + '</div>' : '') +
        '<div class="body">' +
          '<div class="tt">' + esc(t.title) + '</div>' +
          '<div class="why">' + esc(t.reason) + '</div>' +
          '<div class="meta">' + meta.join('') + '</div>' +
        '</div>' +
        '<button class="box" aria-label="完成">✓</button>' +
      '</div>';
  }

  function renderToday() {
    var d = viewDate;
    var built = R.buildTasks(state, d);
    var doneToday = Object.keys(state.done || {}).filter(function (k) {
      return k.indexOf(d + '#') === 0;
    }).length;
    var html = '';

    /* 今天的课 */
    html += '<div class="h">今天的课 <span class="n">' + built.hasClassToday.length + ' 门</span></div>';
    if (built.hasClassToday.length) {
      html += '<div class="chips">';
      built.hasClassToday.forEach(function (x) {
        var s = slotToday(x.course, d);
        var text = x.course.name + (s ? ' <small>' + esc(s.period) + ' · ' + esc(x.course.place || '') + '</small>' : '');
        html += '<span class="chip"><i style="background:' + esc(x.course.color || '#888') + '"></i>' + text + '</span>';
      });
      html += '</div>';
    } else {
      html += '<div class="chips"><span class="chip">今天没课</span></div>';
    }

    /* 首次打开：历史课次会被算成积压，给一个「从今天开始」的出口 */
    if (!state.ignoredBefore && built.all.filter(function (t) { return t.kind === R.KIND.CARRY; }).length >= 4) {
      html += '<div class="card banner"><div class="bd"><b>第一次打开？</b>' +
        '之前没勾过的课后复习现在都被算成积压了。不想回头补，就从今天开始记。</div>' +
        '<div class="btns" style="padding:0 15px 14px"><button class="b" data-act="baseline">从今天开始记</button></div></div>';
    }

    /* 今日必做：先把「积压复习」摘出去，别让它把今天真正该做的事淹掉 */
    if (built.all.length) {
      var backlog = built.all.filter(function (t) { return t.kind === R.KIND.CARRY; });
      var main = built.all.filter(function (t) { return t.kind !== R.KIND.CARRY; });
      if (!main.length) { main = backlog.slice(0, 3); backlog = backlog.slice(3); }
      var top = main.slice(0, 3);
      var rest = main.slice(3);

      html += '<div class="h">今天先做这几件' +
        (doneToday ? ' <span class="n">已勾 ' + doneToday + ' 件</span>' : '') + '</div>';
      html += '<div class="card top">' +
        '<div class="top-hd"><h2>按「急 → 该趁热」排的 ' + top.length + ' 件</h2>' +
        '<span>' + (backlog.length ? '积压单独列在下面' : (rest.length ? '剩下的在下面' : '今天事不多')) + '</span></div>';
      top.forEach(function (t, i) { html += taskHTML(t, i + 1); });
      html += '</div>';

      if (rest.length) {
        html += '<div class="h">剩下的 <span class="n">' + rest.length + ' 件</span></div>';
        var groups = {};
        var order = [];
        rest.forEach(function (t) {
          if (!groups[t.courseId]) { groups[t.courseId] = []; order.push(t.courseId); }
          groups[t.courseId].push(t);
        });
        order.forEach(function (cid) {
          var list = groups[cid];
          var c = courseOf(cid);
          html += '<details class="grp" open>' +
            '<summary><i style="width:7px;height:7px;border-radius:50%;display:inline-block;background:' +
            esc((c && c.color) || '#888') + '"></i>' + esc(list[0].courseName) +
            '<span class="cnt">' + list.length + ' 件</span></summary>';
          list.forEach(function (t) { html += taskHTML(t, 0); });
          html += '</details>';
        });
      }

      /* 积压：默认收起，一次补一件就够 */
      if (backlog.length) {
        var worst = 0;
        backlog.forEach(function (t) { if ((t.overdueDays || 0) > worst) worst = t.overdueDays; });
        html += '<details class="grp backlog"><summary>积压复习' +
          '<span class="cnt">' + backlog.length + ' 件</span></summary>' +
          '<div class="hint" style="padding:0 15px 12px">' +
          (worst ? '最老的一件拖了 ' + worst + ' 天。' : '') +
          '不用一次补完，勾掉一件就少一件。</div>';
        backlog.forEach(function (t) { html += taskHTML(t, 0); });
        html += '</details>';
      }
    } else {
      html += '<div class="h">今天先做这几件</div><div class="card empty">' +
        '<div class="big">清空了</div>今天排到的都做完了，去下面看看明天要上的课。</div>';
    }

    /* 明天预告 */
    var next = R.nextSessionAfter(state, d);
    if (next) {
      html += '<div class="h">下一次课</div><div class="card row">' +
        '<div class="row-hd"><i style="width:8px;height:8px;border-radius:50%;background:' +
        esc(next.course.color || '#888') + '"></i><span class="nm">' + esc(next.course.name) + '</span>' +
        '<span class="badge">' + esc(R.fmtCN(next.date)) + '</span></div>' +
        '<div class="now">第 ' + next.k + ' 次课 · <b>' + esc(next.chapter.chapter.title) + '</b>' +
        ' <span style="color:var(--ink-3)">(本章第 ' + next.chapter.sessionInChapter + '/' + next.chapter.totalInChapter + ' 次)</span></div>' +
        '</div>';
    }

    $('#view').innerHTML = html;
    $('#foot').innerHTML = '课表与大纲来自 ' + esc(Seed.META.source) + '<br>勾选只存在这台手机上，换手机用「设置 → 导出」';
  }

  /* ---------------- 进度 ---------------- */

  function renderProgress() {
    var stats = R.courseStats(state, viewDate);
    var html = '<div class="h">每门课跟到哪了 <span class="n">' + R.fmtCN(viewDate) + '</span></div>';
    html += '<div class="card">';
    stats.forEach(function (s) {
      var c = s.course;
      var pct = s.planK ? Math.min(100, Math.round((s.actual / s.planK) * 100)) : 0;
      var badge = s.finished
        ? '<span class="badge">大纲讲完</span>'
        : s.behind === 0
          ? '<span class="badge ok">跟上了</span>'
          : '<span class="badge bad">落后 ' + s.behind + ' 次</span>';
      html += '<div class="row">' +
        '<div class="row-hd"><i style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:' +
        esc(c.color || '#888') + '"></i><span class="nm">' + esc(c.name) + '</span>' + badge + '</div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="now">应到 <b>' + s.planK + '</b> 次 · 已勾 <b>' + s.actual + '</b> 次 · 大纲共 ' + s.limit + ' 次' +
        (s.skipped ? ' · 起点前 ' + s.skipped + ' 次不计' : '') + '</div>' +
        (s.nowChapter
          ? '<div class="now">现在应该讲到 <b>' + esc(s.nowChapter.chapter.title) + '</b></div>'
          : '') +
        '</div>';
    });
    html += '</div>';

    var up = R.upcomingSummary(state, viewDate);
    html += '<div class="h">未来 7 天 <span class="n">' + up.length + ' 次课</span></div>';
    if (!up.length) {
      html += '<div class="card empty">接下来一周没有课。</div>';
    } else {
      html += '<div class="card">';
      up.forEach(function (u) {
        var k = R.sessionNoOn(u.course, state.termStart, u.date);
        var ch = R.chapterAt(u.course.outline, k);
        var sl = slotToday(u.course, u.date);
        html += '<div class="row"><div class="row-hd">' +
          '<i style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:' +
          esc(u.course.color || '#888') + '"></i>' +
          '<span class="nm">' + esc(u.course.name) + '</span>' +
          '<span class="badge">' + esc(R.fmtCN(u.date)) + ' ' + esc(sl ? sl.period : '') + '</span></div>' +
          '<div class="now">第 ' + k + ' 次课' + (ch ? ' · ' + esc(ch.chapter.title) : '') +
          ' <span style="color:var(--ink-3)">' + esc(u.course.place || '') + '</span></div></div>';
      });
      html += '</div>';
    }
    $('#view').innerHTML = html;
    $('#foot').innerHTML = '「落后」= 课表上已经上过的次数 − 你勾掉的课后复习次数' +
      (state.ignoredBefore ? '<br>复习起点 ' + esc(state.ignoredBefore) + '：之前的课次不计入应到' : '');
  }

  /* ---------------- 设置 ---------------- */

  function renderSettings() {
    var html = '';

    html += '<div class="h">学期</div><div class="card">' +
      '<div class="field"><label>第 1 周的周一（开学日）</label>' +
      '<input type="date" id="termStart" value="' + esc(state.termStart) + '">' +
      (state.termStartGuessed
        ? '<div class="hint">⚠︎ 课表 PDF 里没写开学日，这个日期是按「9 月第一周」估的。' +
          '如果上面的「第 N 周」和你实际的不符，把这里改成教务处校历上的开学第一周周一即可，其它全自动跟着变。</div>'
        : '<div class="hint">周次、该讲到第几章都从这个日期推算。</div>') +
      '</div>' +
      '<div class="btns"><button class="b" id="setTerm">保存开学日</button></div>' +
      '</div>';

    html += '<div class="h">作业 <span class="n">' + (state.homework || []).length + ' 条</span></div><div class="card">';
    if (!(state.homework || []).length) {
      html += '<div class="empty" style="padding:16px 15px">还没有作业。只有「到期或逾期」的作业会进今日清单。</div>';
    } else {
      state.homework.forEach(function (hw, i) {
        html += '<div class="hw"><span>' + esc(hw.title) + '</span>' +
          '<span style="color:var(--ink-3);font-size:11.5px">' + esc(R.fmtCN(hw.dueOn)) + '</span>' +
          '<span class="x" data-delhw="' + i + '">删除</span></div>';
      });
    }
    html += '<div class="field"><label>新作业</label>' +
      '<select id="hwCourse">' + state.courses.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>内容</label><input id="hwTitle" placeholder="如：习题 1.4 第 1-8 题"></div>' +
      '<div class="field"><label>截止日期</label><input type="date" id="hwDue" value="' + esc(viewDate) + '"></div>' +
      '<div class="btns"><button class="b primary" id="addHw">加进作业表</button></div></div>';

    html += '<div class="h">复习起点</div><div class="card">' +
      '<div class="field"><label>忽略这个日期之前的未勾复习</label>' +
      '<div style="font-size:14px">' + esc(state.ignoredBefore || '未设置（从开学第一周开始算）') + '</div>' +
      '<div class="hint">课表 1-16 周每周都有课，所以第一次打开时，前几周没勾的课后复习会全被算成积压。' +
      '点下面的按钮把「今天」当起点，之前的都不再催。</div>' +
      '<div class="btns" style="padding:13px 0 0">' +
      '<button class="b" id="setBaseline">从今天开始记</button>' +
      (state.ignoredBefore ? '<button class="b danger" id="clearBaseline">清除，恢复全部历史</button>' : '') +
      '</div></div></div>';

    html += '<div class="h">数据</div><div class="card">' +
      '<div class="btns">' +
      '<button class="b" id="copy">复制今日清单</button>' +
      '<button class="b" id="export">导出 JSON</button>' +
      '<button class="b" id="importBtn">导入 JSON</button>' +
      '</div>' +
      '<div class="btns"><button class="b danger" id="reset">恢复课表默认（清空勾选）</button></div>' +
      '<div class="hint" style="padding:0 15px 14px">勾选和作业存在浏览器 localStorage 里；换设备就用导出/导入。</div>' +
      '</div>';

    html += '<details class="grp" style="margin-top:22px"><summary>高级：直接改教学大纲（JSON）</summary>' +
      '<div class="field"><label>课程数组，改完点保存</label>' +
      '<textarea id="outlineJson" style="width:100%;height:220px;border-radius:10px;border:1px solid var(--line);' +
      'background:var(--paper);color:var(--ink);font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:10px">' +
      esc(JSON.stringify(state.courses.map(function (c) {
        return { id: c.id, name: c.name, outline: c.outline };
      }), null, 1)) + '</textarea>' +
      '<div class="hint">每个章节 sessions = 这门课讲这一章要几次课。课次总和最好等于这门课全学期的上课次数。</div>' +
      '<div class="btns" style="padding:13px 0 0"><button class="b" id="saveOutline">保存大纲</button></div></div>' +
      '</details>';

    html += '<div class="h">关于</div><div class="card"><div class="field">' +
      '<div style="font-size:13px;line-height:1.75">' +
      esc(Seed.META.term) + ' · ' + esc(Seed.META.campus) + '<br>' +
      esc(Seed.META.source) + '</div>' +
      '<div class="hint">这个工具不猜、不调 AI：一切结论都由「开学日 + 课表 + 大纲」推出来，' +
      '所以离线可用、结果稳定、每天看得懂为什么。</div></div></div>';

    $('#view').innerHTML = html;
    $('#foot').innerHTML = 'v1 · 数据只在本机';

    $('#setTerm').onclick = function () {
      var v = $('#termStart').value;
      if (!v) return toast('先选个日期');
      state.termStart = v;
      state.termStartGuessed = false;
      save();
      toast('已保存，周次重算了');
      render();
    };

    $('#addHw').onclick = function () {
      var title = ($('#hwTitle').value || '').trim();
      var due = $('#hwDue').value;
      if (!title) return toast('作业内容不能空');
      if (!due) return toast('选个截止日期');
      state.homework.push({
        id: 'hw' + Date.now(),
        courseId: $('#hwCourse').value,
        title: title,
        dueOn: due,
        estMin: 40
      });
      save();
      toast('已加，到期那天会进今日清单');
      render();
    };

    Array.prototype.forEach.call(document.querySelectorAll('[data-delhw]'), function (el) {
      el.onclick = function () {
        state.homework.splice(Number(el.getAttribute('data-delhw')), 1);
        save();
        render();
      };
    });

    $('#copy').onclick = function () {
      var built = R.buildTasks(state, viewDate);
      if (!built.all.length) return toast('清单是空的');
      var lines = [R.fmtCN(viewDate) + ' · ' + weekLabel(viewDate), ''];
      built.all.forEach(function (t, i) {
        lines.push((i + 1) + '. ' + t.title + '（' + t.estMin + ' 分钟）');
        lines.push('   ' + t.reason);
      });
      var text = lines.join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('已复制，去贴到微信'); },
          function () { toast('复制失败，长按页面选中吧'); });
      } else {
        toast('这个浏览器不支持自动复制');
      }
    };

    $('#export').onclick = function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'today-' + R.toISO(stateNow()) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
      toast('已导出');
    };

    $('#importBtn').onclick = function () {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () {
          try {
            var s = JSON.parse(String(fr.result));
            if (!s || !s.courses || !s.courses.length) throw new Error('缺少 courses');
            state = normalize(s);
            save();
            toast('已导入 ' + state.courses.length + ' 门课');
            render();
          } catch (e) {
            toast('导入失败：' + (e && e.message ? e.message : e));
          }
        };
        fr.readAsText(f);
      };
      inp.click();
    };

    $('#setBaseline').onclick = setBaseline;

    if ($('#clearBaseline')) {
      $('#clearBaseline').onclick = function () {
        state.ignoredBefore = '';
        save();
        toast('已恢复：历史复习重新计入');
        render();
      };
    }

    $('#reset').onclick = function () {
      if (!confirm('恢复课表默认数据，并清空所有勾选和作业？')) return;
      state = Seed.defaultState();
      save();
      toast('已恢复');
      render();
    };

    $('#saveOutline').onclick = function () {
      try {
        var arr = JSON.parse($('#outlineJson').value);
        if (!Array.isArray(arr)) throw new Error('需要是数组');
        state.courses.forEach(function (c) {
          arr.forEach(function (o) {
            if (o.id === c.id && Array.isArray(o.outline)) c.outline = o.outline;
          });
        });
        save();
        toast('大纲已更新');
        render();
      } catch (e) {
        toast('JSON 有问题：' + (e && e.message ? e.message : e));
      }
    };
  }

  /* ---------------- 交互 ---------------- */

  function setBaseline() {
    state.ignoredBefore = R.toISO(stateNow());
    save();
    toast('已从今天开始记：' + state.ignoredBefore + ' 之前的复习不再算欠');
    render();
  }

  function onViewClick(e) {
    var act = e.target.closest ? e.target.closest('[data-act]') : null;
    if (act) {
      if (act.getAttribute('data-act') === 'baseline') setBaseline();
      return;
    }
    var t = e.target.closest ? e.target.closest('.todo, .li') : null;
    if (!t) return;
    var id = t.getAttribute('data-id');
    if (!id) return;
    if (state.done[id]) delete state.done[id];
    else state.done[id] = Date.now();
    save();
    toast(state.done[id] ? '勾掉了，还剩 ' + (R.buildTasks(state, viewDate).all.length) + ' 件' : '已取消勾选');
    render();
  }

  function syncURL() {
    try {
      var q = viewDate === R.toISO(stateNow()) ? '' : '?d=' + viewDate;
      var h = tab === 'today' ? '' : '#' + tab;
      history.replaceState(null, '', location.pathname + q + h);
    } catch (e) { /* file:// 下偶尔不让改，忽略 */ }
  }

  function render() {
    renderHeader();
    if (tab === 'today') renderToday();
    else if (tab === 'progress') renderProgress();
    else renderSettings();
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    });
    syncURL();
  }

  function shiftDay(n) {
    viewDate = R.addDays(viewDate, n);
    render();
  }

  /* ---------------- 启动 ---------------- */

  if (!R || !Seed) {
    document.getElementById('view').innerHTML =
      '<div class="card empty"><div class="big">rules.js / seed.js 没加载上</div>' +
      '请确认三个 js 文件在同一个目录，且用 http:// 或文件直开都可以。</div>';
    return;
  }

  $('#view').addEventListener('click', onViewClick);
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.addEventListener('click', function () {
      tab = b.getAttribute('data-tab');
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  $('#prevDay').addEventListener('click', function () { shiftDay(-1); });
  $('#nextDay').addEventListener('click', function () { shiftDay(1); });
  $('#hdrDate').addEventListener('click', function () {
    viewDate = R.toISO(stateNow());
    render();
    toast('回到今天');
  });

  render();

  // 每天首次打开时，如果跨天了就把视图拉回今天
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      var t = R.toISO(stateNow());
      if (t !== viewDate && tab === 'today' && R.diffDays(viewDate, t) === 1) {
        viewDate = t;
        render();
      }
    }
  });

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 离线缓存失败不影响使用 */ });
    });
  }
})();
