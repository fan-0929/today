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
  /* 点了勾选但还没确认的那一条（防止误触直接把任务划掉） */
  var pendingDone = null;

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

  function confirmBar(id, pend) {
    if (!pend) return '';
    return '<div class="confirm">' +
      '<div class="q">点错了？现在还能后悔。</div>' +
      '<button class="b primary" data-act="confirmDone" data-id="' + esc(id) + '">确定做了</button>' +
      '<button class="b" data-act="cancelDone">取消</button>' +
      '</div>';
  }

  /* 作业台账的一行：截止时间从早到晚排，逾期/今天到期标红 */
  function hwHTML(x, alsoToday) {
    var id = 'hw#' + x.hw.id;
    var pend = pendingDone === id;
    var badge, cls = '';
    if (x.state === 'overdue') { badge = '逾期 ' + x.daysLeft + ' 天'; cls = 'hot'; }
    else if (x.state === 'today') { badge = '今天到期'; cls = 'hot'; }
    else if (x.daysLeft === -1) { badge = '明天到期'; cls = 'warm'; }
    else { badge = '还有 ' + (-x.daysLeft) + ' 天'; }
    return '' +
      '<div class="todo hw' + (pend ? ' pend' : '') + '" data-id="' + esc(id) + '">' +
        '<div class="body">' +
          '<div class="tt"><i class="cdot" style="background:' + esc(x.color) + '"></i>' +
            esc(x.hw.title) + '</div>' +
          '<div class="meta">' +
            '<span class="tag ' + cls + '">' + esc(badge) + '</span>' +
            '<span>' + esc(R.fmtCN(x.dueOn)) + '</span>' +
            '<span>' + esc(x.courseName) + '</span>' +
            (alsoToday ? '<span class="tag">也在今日清单</span>' : '') +
          '</div>' +
        '</div>' +
        '<button class="box" aria-label="完成">✓</button>' +
      '</div>' + confirmBar(id, pend);
  }

  function taskHTML(t, rank) {
    var done = !!state.done[t.id];
    var pend = pendingDone === t.id;
    var tagClass = t.prio >= 100 ? 'hot' : t.prio >= 60 ? 'warm' : '';
    var meta = [];
    meta.push('<span class="tag ' + tagClass + '">' + esc(KIND_LABEL[t.kind] || t.kind) + '</span>');
    meta.push('<span>' + esc(t.courseName) + '</span>');
    if (t.estMin) meta.push('<span>约 ' + t.estMin + ' 分钟</span>');
    return '' +
      '<div class="todo' + (done ? ' done' : '') + (pend ? ' pend' : '') + '" data-id="' + esc(t.id) + '">' +
        (rank ? '<div class="rank">' + rank + '</div>' : '') +
        '<div class="body">' +
          '<div class="tt">' + esc(t.title) + '</div>' +
          '<div class="why">' + esc(t.reason) + '</div>' +
          '<div class="meta">' + meta.join('') + '</div>' +
        '</div>' +
        '<button class="box" aria-label="完成">✓</button>' +
      '</div>' + confirmBar(t.id, pend);
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

    /* 拍照 / 选截图 → 认出作业 → 确认后入表 */
    html += '<div class="shotbar">' +
      '<button class="shot" data-act="shoot">📷 拍照 / 选截图加作业' +
      '<small>' + (hasKey() ? '交给模型认字，你确认一下再进作业表' : '先在设置里填一个 Key') + '</small></button>' +
      '</div>';

    /* 首次打开：历史课次会被算成积压，给一个「从今天开始」的出口 */
    if (!state.ignoredBefore && built.all.filter(function (t) { return t.kind === R.KIND.CARRY; }).length >= 4) {
      html += '<div class="card banner"><div class="bd"><b>第一次打开？</b>' +
        '之前没勾过的课后复习现在都被算成积压了。不想回头补，就从今天开始记。</div>' +
        '<div class="btns" style="padding:0 15px 14px"><button class="b" data-act="baseline">从今天开始记</button></div></div>';
    }

    /* 作业台账：按截止时间从早到晚，就在「今天先做这几件」前面 */
    var hwList = R.homeworkList(state, d);
    if (hwList.length) {
      var inToday = {};
      built.all.forEach(function (t) {
        var i = t.id.indexOf('#hw-');
        if (i >= 0) inToday[t.id.slice(i + 4)] = 1;
      });
      html += '<div class="h">作业 <span class="n">' + hwList.length + ' 条 · 按截止时间排</span></div>' +
        '<div class="card hwcard">';
      hwList.forEach(function (x) { html += hwHTML(x, !!inToday[x.hw.id]); });
      html += '</div>';
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

    html += '<div class="h">智能识别 <span class="n">' + (hasKey() ? '已填 Key（尾号 ' + esc(apiKey().slice(-4)) + '）' : '未填 Key') + '</span></div><div class="card">' +
      (storageOK ? '' : '<div class="hint" style="padding:12px 15px 0;color:var(--red)">' +
        '⚠ 这个浏览器不让本地存东西（无痕/隐私模式？）。Key 只能这次开着有效，关掉页面就得重填。' +
        '去设置里关掉无痕模式再开一次就能长期记住。</div>') +
      '<div class="field"><label>智谱 API Key（只存这台设备，不进导出文件）</label>' +
      '<input type="text" id="apiKey" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="open.bigmodel.cn 控制台里的 Key" value="' + esc(apiKey()) + '">' +
      '<div class="hint">拍照时要把这张图发给智谱的视觉模型（先在本地压到 1600px，照片里的位置信息 EXIF 已丢弃）。' +
      (hasKey() ? '<br>当前已存 ' + apiKey().length + ' 位：…' + esc(apiKey().slice(-4)) + '（' + (storageOK ? '已写进这台设备' : '仅本次有效') + '）'
                : '<br>没填 Key 时，拍照按钮只会提示你去填，不会发任何东西出去。') +
      '</div></div>' +
      '<div class="field"><label>模型</label><input id="apiModel" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(modelName()) + '">' +
      '<div class="hint">默认 glm-4v-flash。若提示「模型名不对」，改成 glm-4v-plus 或 glm-4v 再试一次。</div></div>' +
      '<div class="btns"><button class="b primary" id="saveKey">保存</button>' +
      '<button class="b" id="pasteKey">粘贴</button>' +
      '<button class="b" id="testKey">测试连接</button>' +
      (hasKey() ? '<button class="b danger" id="clearKey">清除 Key</button>' : '') + '</div></div>';

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

    $('#saveKey').onclick = function () {
      var k = cleanKey($('#apiKey').value);
      var m = ($('#apiModel').value || '').trim();
      var wrote = setApiKey(k);
      setModelName(m);
      if (!k) toast('已清空 Key');
      else if (!wrote) toast('存不进去：浏览器禁用了本地存储（开无痕了？）——这次仍能用');
      else if (apiKey() !== k) toast('没写进去，再点一次保存');
      else toast('已保存 ' + k.length + ' 位，尾号 ' + k.slice(-4));
      render();
    };
    if ($('#pasteKey')) {
      $('#pasteKey').onclick = function () {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          toast('这个浏览器不让读剪贴板，长按输入框粘贴吧');
          return;
        }
        navigator.clipboard.readText().then(function (t) {
          var el = $('#apiKey');
          el.value = cleanKey(t);
          toast(el.value ? '粘进来了 ' + el.value.length + ' 位，记得点保存' : '剪贴板是空的');
        }).catch(function () {
          toast('读不了剪贴板，长按输入框选「粘贴」');
        });
      };
    }
    $('#testKey').onclick = testConnection;
    if ($('#clearKey')) {
      $('#clearKey').onclick = function () {
        setApiKey('');
        toast('Key 已清除');
        render();
      };
    }

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

  /* ---------------- 智能识别：拍照 / 截图 → 任务 ---------------- */

  var KEY_SLOT = 'today.key.v1';   // 模型 Key 单独存，不进 state、不进导出的 JSON
  var MODEL_SLOT = 'today.model.v1';
  var DEFAULT_MODEL = 'glm-4v-flash';
  var API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

  /* 无痕模式 / 禁用存储的浏览器会让 localStorage 写失败，这里探测一次并留内存兜底 */
  var memStore = {};
  var storageOK = (function () {
    try {
      localStorage.setItem('__probe__', '1');
      var v = localStorage.getItem('__probe__');
      localStorage.removeItem('__probe__');
      return v === '1';
    } catch (e) { return false; }
  })();

  function lsGet(k) {
    try {
      var v = localStorage.getItem(k);
      if (v != null) return v;
    } catch (e) { /* 掉到内存兜底 */ }
    return memStore[k] || '';
  }
  function lsSet(k, v) {           /* 返回「是否真的落盘」 */
    memStore[k] = v || '';
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }
  function apiKey() { return lsGet(KEY_SLOT); }
  function setApiKey(v) { return lsSet(KEY_SLOT, v); }
  function hasKey() { return !!apiKey(); }
  function modelName() { return lsGet(MODEL_SLOT) || DEFAULT_MODEL; }
  function setModelName(v) { return lsSet(MODEL_SLOT, v || ''); }
  /* 从输入框读出干净的 Key：去掉空格、换行、零宽字符、全角空格 */
  function cleanKey(s) {
    return String(s || '').replace(/[\s\u3000\u200b-\u200d\ufeff]/g, '');
  }

  function openSheet(html) {
    $('#sheetIn').innerHTML = html;
    $('#sheet').classList.add('on');
    $('#backdrop').classList.add('on');
  }
  function closeSheet() {
    $('#sheet').classList.remove('on');
    $('#backdrop').classList.remove('on');
  }

  /** 长边压到 1600、JPEG 0.82：上传快，顺便把照片的 EXIF（含定位）丢掉 */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600;
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) { URL.revokeObjectURL(url); return reject(new Error('这张图读不出尺寸')); }
        var scale = Math.min(1, max / Math.max(w, h));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        try { resolve(canvas.toDataURL('image/jpeg', 0.82)); }
        catch (e) { reject(new Error('图片处理失败，换一张试试')); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('这张图打不开')); };
      img.src = url;
    });
  }

  function postVision(messages) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey() },
      body: JSON.stringify(Parse.buildRequestBody(modelName(), messages)),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (txt) { return { status: res.status, txt: txt }; });
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (r.status < 200 || r.status >= 300) throw new Error(Parse.explainError(r.status, r.txt));
      var data;
      try { data = JSON.parse(r.txt); } catch (e) { throw new Error('模型返回的不是 JSON'); }
      var c = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : null;
      if (!c) throw new Error('模型没返回内容');
      return typeof c === 'string' ? c : JSON.stringify(c);
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('识别超时（30 秒）。图太大或网太慢，换一张小点的');
      throw new Error(err && err.message ? err.message : Parse.explainError(0));
    });
  }

  function startShot() {
    if (!hasKey()) {
      openSheet('<h3>先填一个 Key</h3>' +
        '<div class="sub">拍照识别要调智谱的视觉模型。Key 只存在你这台手机上，不上传、也不进导出文件。</div>' +
        '<div class="acts"><button data-sheet="close">算了</button>' +
        '<button class="primary" data-sheet="goto-key">去设置填</button></div>');
      return;
    }
    var input = $('#shotInput');
    input.value = '';
    input.click();
  }

  function onShot(file) {
    if (!file) return;
    openSheet('<h3>正在认这张图…</h3><div class="sub">压图 → 上传 → 解析，通常 3–8 秒</div><div id="shotThumb"></div>');
    compressImage(file).then(function (dataUrl) {
      var box = $('#shotThumb');
      if (box) box.innerHTML = '<img class="thumb" alt="刚选的图" src="' + dataUrl + '">';
      return postVision(Parse.buildMessages(
        state.courses.map(function (c) { return c.name; }), viewDate, dataUrl));
    }).then(function (text) {
      showResult(Parse.normalizeResult(text, { today: viewDate, courses: state.courses }));
    }).catch(function (err) {
      openSheet('<h3>没认出来</h3><div class="sub">' + esc(err.message) + '</div>' +
        '<div class="acts"><button data-sheet="close">知道了</button>' +
        '<button class="primary" data-sheet="retry">再试一张</button></div>');
    });
  }

  /* 确认卡：可能有多条 —— 每条一行，改哪条都行，删掉也行 */
  function courseOptions(selectedId) {
    var opts = '<option value="">（不确定，先不选）</option>';
    state.courses.forEach(function (c) {
      opts += '<option value="' + esc(c.id) + '"' +
        (c.id === selectedId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    });
    return opts;
  }

  function hwRowHTML(t, i) {
    return '<div class="hwrow">' +
      '<div class="hwr"><span class="idx">' + (i + 1) + '</span>' +
        '<select data-f="course">' + courseOptions(t.courseId) + '</select>' +
        '<button class="del" data-sheet="drop" aria-label="删掉这条">✕</button></div>' +
      '<input data-f="title" value="' + esc(t.title) + '" placeholder="要做的事">' +
      '<div class="row2">' +
        '<div><label>截止</label><input type="date" data-f="due" value="' + esc(t.dueOn) + '"></div>' +
        '<div><label>分钟</label><input type="number" data-f="min" min="5" max="240" value="' + t.estMin + '"></div>' +
      '</div>' +
    '</div>';
  }

  function showResult(r) {
    if (!r || (!r.tasks || !r.tasks.length)) {
      var why = !r ? '解析失败'
        : r.reason === 'no-task' ? '图里没看出「要你做的事」'
        : r.reason === 'no-title' ? '认出了字，但没凑成一条完整的事'
        : '模型没给出能用的结果';
      openSheet('<h3>' + esc(why) + '</h3>' +
        '<div class="sub">换一张更清楚的图，或者直接手填一条。</div>' +
        (r && r.raw ? '<details><summary>图里认到的原文</summary><pre>' + esc(r.raw) + '</pre></details>' : '') +
        '<div class="acts"><button data-sheet="close">算了</button>' +
        '<button class="primary" data-sheet="retry">再试一张</button>' +
        '</div>');
      return;
    }

    var n = r.tasks.length;
    var head = r.draft
      ? '<h3>先把看到的内容列出来</h3><div class="sub">模型这次没给准话，但图里的字我读到了。改改标题、确认下日期就能用。</div>'
      : n > 1
        ? '<h3>认出 ' + n + ' 条，逐条确认</h3><div class="sub">图里有多条作业，我都列出来了；多的删掉、漏的补一行</div>'
        : '<h3>认出来了，确认一下</h3><div class="sub">哪一项不对就改哪一项，改完再入库</div>';

    var body = '';
    r.tasks.forEach(function (t, i) { body += hwRowHTML(t, i); });

    openSheet(head + body +
      (r.warnings && r.warnings.length ? '<div class="warn">' + r.warnings.map(esc).join('<br>') + '</div>' : '') +
      (r.raw ? '<details><summary>图里认到的原文</summary><pre>' + esc(r.raw) + '</pre></details>' : '') +
      '<div class="acts"><button data-sheet="close">不要</button>' +
      '<button class="primary" data-sheet="save">全部加入（' + n + ' 条）</button></div>');
  }

  function saveFromSheet() {
    var rows = Array.prototype.slice.call(document.querySelectorAll('#sheetIn .hwrow'));
    if (!rows.length) return toast('没有可加入的条目');
    var added = 0, skipped = 0;
    var base = Date.now();
    rows.forEach(function (row, i) {
      var pick = function (f) {
        var el = row.querySelector('[data-f=' + f + ']');
        return el ? el.value : '';
      };
      var title = String(pick('title') || '').replace(/[\s　]+/g, ' ').trim();
      if (!title) { skipped++; return; }
      var dueOn = pick('due') || R.addDays(viewDate, 1);
      var estMin = Number(pick('min')) || 30;
      state.homework.push({
        id: 'hw' + (base + i),
        courseId: pick('course') || '',
        title: title.slice(0, 60),
        dueOn: dueOn,
        estMin: Math.max(5, Math.min(240, Math.round(estMin))),
        from: 'shot'
      });
      added++;
    });
    if (!added) return toast('至少一条要有内容');
    save();
    closeSheet();
    toast('已加入 ' + added + ' 条作业' + (skipped ? '（' + skipped + ' 条没内容，跳过）' : '') + '，到期那天进今日清单');
    render();
  }

  /* 删掉确认卡里的一条，并把序号重排 */
  function dropSheetRow(btn) {
    var row = btn.closest('.hwrow');
    if (!row) return;
    row.parentNode.removeChild(row);
    var rows = document.querySelectorAll('#sheetIn .hwrow');
    if (!rows.length) { closeSheet(); return toast('都删掉了'); }
    for (var i = 0; i < rows.length; i++) {
      var idx = rows[i].querySelector('.idx');
      if (idx) idx.textContent = String(i + 1);
    }
    var saveBtn = document.querySelector('#sheetIn [data-sheet=save]');
    if (saveBtn) saveBtn.textContent = '全部加入（' + rows.length + ' 条）';
  }

  function testConnection() {
    if (!hasKey()) return toast('先填 Key 再测');
    toast('测试中…');
    var px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    postVision([{ role: 'user', content: [
      { type: 'image_url', image_url: { url: px } },
      { type: 'text', text: '这是一张 1x1 的图。只回两个字：收到' }
    ]}]).then(function () {
      toast('连通了：' + modelName() + ' 可用');
    }).catch(function (err) {
      toast('不行：' + err.message);
    });
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
      var a = act.getAttribute('data-act');
      if (a === 'baseline') setBaseline();
      else if (a === 'shoot') startShot();
      else if (a === 'confirmDone') commitDone(act.getAttribute('data-id'));
      else if (a === 'cancelDone') { pendingDone = null; render(); }
      return;
    }
    var t = e.target.closest ? e.target.closest('.todo, .li') : null;
    if (!t) return;
    var id = t.getAttribute('data-id');
    if (!id) return;
    if (pendingDone === id) return;   /* 已经在等确认，别重复触发 */
    pendingDone = id;                 /* 先不写库，等「确定做了」 */
    render();
  }

  function commitDone(id) {
    pendingDone = null;

    /* 作业台账那一行：hw#<id> */
    if (id.indexOf('hw#') === 0) {
      markHomeworkDone(id.slice(3));
      toast('作业已划掉');
      render();
      return;
    }

    /* 今日清单里的作业任务：顺手把台账那条也划掉，免得两处不一致 */
    var m = /#hw-(.+)$/.exec(id);
    if (m) markHomeworkDone(m[1]);

    if (state.done[id]) delete state.done[id];
    else state.done[id] = Date.now();
    save();
    var left = R.buildTasks(state, viewDate).all.length;
    toast(state.done[id] ? '记下了，还剩 ' + left + ' 件' : '已取消勾选');
    render();
  }

  function markHomeworkDone(hwid) {
    var hit = false;
    (state.homework || []).forEach(function (h) {
      if (h && h.id === hwid) { h.doneOn = R.toISO(stateNow()); hit = true; }
    });
    if (hit) save();
    return hit;
  }

  function clearPending() {
    if (pendingDone) { pendingDone = null; return true; }
    return false;
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
    clearPending();
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
      clearPending();
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

  /* 拍照识别相关的挂载 */
  $('#shotInput').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    onShot(f);
  });
  $('#backdrop').addEventListener('click', closeSheet);
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-sheet]') : null;
    if (!el) return;
    var a = el.getAttribute('data-sheet');
    if (a === 'close') closeSheet();
    else if (a === 'save') saveFromSheet();
    else if (a === 'drop') dropSheetRow(el);
    else if (a === 'retry') startShot();
    else if (a === 'goto-key' || a === 'manual') {
      closeSheet();
      tab = 'settings';
      render();
    }
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
