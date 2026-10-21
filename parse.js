/* 今日任务决策器 · 智能识别解析层
 * 纯函数，不碰 DOM、不联网，可直接在 Node 里单测：node test-parse.js
 *
 * 职责边界：
 *   这里只做「怎么问」和「怎么把模型/OCR 的回答清洗成能入库的任务」，
 *   以及日期、课程、时长这些易错字段的兜底。真正发请求、渲染确认卡在 app.js。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Parse = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'];
  var MAX_TITLE = 60;
  var MAX_TASKS = 8;

  /* ---------- 日期工具（与 rules.js 同口径，独立一份避免循环依赖） ---------- */

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
  function isoWeekday(iso) {
    return ((toDate(iso).getDay() + 6) % 7) + 1; // 周一=1
  }
  function diffDays(from, to) {
    return Math.round((toDate(to) - toDate(from)) / 86400000);
  }

  /* ---------- 课程模糊匹配 ---------- */

  // 学生口语里的叫法 → 课程名里的关键词
  var ALIAS = [
    ['高数', '高等数学'], ['高等数学', '高等数学'], ['数学', '高等数学'],
    ['c语言', '程序设计'], ['c 语言', '程序设计'], ['编程', '程序设计'], ['程序设计', '程序设计'],
    ['计算机', '程序设计'], ['上机', '程序设计'],
    ['大物实验', '大学物理实验'], ['物理实验', '大学物理实验'],
    ['大物', '大学物理'], ['大学物理', '大学物理'], ['物理', '大学物理'],
    ['化学实验', '大学化学实验'],
    ['大化', '大学化学'], ['大学化学', '大学化学'], ['化学', '大学化学'],
    ['思修', '思想道德'], ['思想道德', '思想道德'], ['思政', '思想道德'], ['道德与法治', '思想道德'],
    ['英语', '大学英语'], ['大英', '大学英语'],
    ['体育', '体育'], ['保健班', '体育'],
    ['国安', '国家安全'], ['国家安全', '国家安全'],
    ['犯罪', '犯罪与预防'], ['犯罪与预防', '犯罪与预防'],
    ['形政', '形势与政策'], ['形势', '形势与政策'], ['形势与政策', '形势与政策'],
    ['物理与技术', '物理学与技术进步'], ['物理学与技术', '物理学与技术进步']
  ];

  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/[\s　]+/g, '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .toLowerCase();
  }

  /** 从一段话里找最匹配的课程；找不到返回 null */
  function matchCourse(text, courses) {
    var t = clean(text);
    if (!t) return null;
    var best = null;

    (courses || []).forEach(function (c) {
      var name = clean(c.name);
      var score = 0;
      if (!name) return;

      if (t === name) score = 1;
      else if (t.indexOf(name) >= 0) score = 0.92;
      else if (name.indexOf(t) >= 0 && t.length >= 2) score = 0.86;

      // 课程名被拆开写时（如「大学物理 A」）用前缀匹配兜底
      if (!score && name.length >= 4) {
        var head = name.slice(0, 4);
        if (t.indexOf(head) >= 0) score = 0.78;
      }

      if (score > (best ? best.score : 0)) best = { course: c, score: score };
    });

    // 口语别名
    ALIAS.forEach(function (pair) {
      if (t.indexOf(pair[0]) < 0) return;
      var want = clean(pair[1]);
      (courses || []).forEach(function (c) {
        var name = clean(c.name);
        if (name.indexOf(want) < 0) return;
        /* 「化学」既能对上「大学化学」也能对上「大学化学实验」：
           名字完全等于别名时给更高分，否则短的课程总会被实验课抢走 */
        var s = name === want ? 0.95 : 0.9;
        if (!best || s > best.score) best = { course: c, score: s };
      });
    });

    return best && best.score >= 0.6 ? best.course : null;
  }

  /* ---------- 截止日期解析 ---------- */

  var CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

  function cnToInt(s) {
    if (/^\d+$/.test(s)) return Number(s);
    if (s === '十') return 10;
    if (s.length === 2 && s[0] === '十') return 10 + (CN_NUM[s[1]] || 0);
    if (s.length === 2 && s[1] === '十') return (CN_NUM[s[0]] || 0) * 10;
    return CN_NUM[s] || 0;
  }

  /**
   * 把各种写法换算成 ISO 日期；认不出来返回 null。
   * 支持：2026-10-24 / 2026/10/24 / 10月24日 / 10-24 / 10/24 /
   *      今天 明天 后天 / 本周五 下周三 周五 周日 / 3日内
   */
  function parseDueDate(text, today) {
    var s = String(text == null ? '' : text).replace(/[\s　]/g, '');
    if (!s) return null;

    var m = s.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    if (m) return safeISO(Number(m[1]), Number(m[2]), Number(m[3]));

    m = s.match(/(\d{1,2})[-月/](\d{1,2})/);
    if (m) {
      var mm = Number(m[1]);
      var dd = Number(m[2]);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        var year = toDate(today).getFullYear();
        var iso = safeISO(year, mm, dd);
        // 跨年：如果算出来的比今天早两个月以上，认为说的是明年
        if (iso && diffDays(iso, today) > 60) iso = safeISO(year + 1, mm, dd);
        return iso;
      }
    }

    if (/今天|今晚|今日/.test(s)) return today;
    if (/大后天/.test(s)) return addDays(today, 3); // 必须排在「后天」前面，否则被当成后天
    if (/后天/.test(s)) return addDays(today, 2);
    if (/明天|明日/.test(s)) return addDays(today, 1);

    var md = s.match(/([一二三四五六七八九十\d]{1,3})日内/);
    if (md) return addDays(today, cnToInt(md[1]));

    /* 「3 天后」「5 天之内」「一周后」「半个月后」 */
    var md2 = s.match(/([零一二两三四五六七八九十百\d]{1,3})\s*天(之内|以内|内|之后|后)/);
    if (md2) return addDays(today, cnToInt(md2[1]));
    if (/半个月(之内|以内|内|之后|后)?/.test(s)) return addDays(today, 15);
    if (/(^|[^个])一周(之内|以内|内|之后|后)/.test(s)) return addDays(today, 7);
    if (/(^|[^个])两?周(之内|以内|内|之后|后)/.test(s)) return addDays(today, 14);

    // 周一~周日 / 本周X / 下周X / 星期X
    var w = s.match(/(下{1,2}|本|这)?(?:周|星期|礼拜)([一二三四五六七日天])/);
    if (w) {
      var target = w[2] === '天' ? 7 : (w[2] === '日' ? 7 : cnToInt(w[2]));
      if (!target) return null;
      var cur = isoWeekday(today);
      var delta = target - cur;
      if (w[1] && w[1].indexOf('下') >= 0) {
        delta += 7 * w[1].length; // 下 = 7，下下 = 14
      } else if (!w[1] && delta < 0) {
        delta += 7; // 只说「周五」而本周五已过 → 下一个周五
      }
      return addDays(today, delta);
    }

    // 只说「下周 / 下周内」「本周」，没给星期几
    var w2 = s.match(/(下{1,2}|本|这)\s*(个)?\s*(周|星期|礼拜)(内|之前|前|交|$)/);
    if (w2) {
      if (w2[1].indexOf('下') >= 0) return addDays(today, 7 * w2[1].length);
      return addDays(today, 7 - isoWeekday(today)); // 本周 → 这周日
    }

    if (/一周内|一周之内|本周内/.test(s)) return addDays(today, 7);
    return null;
  }

  /* ---------- 具体几点 ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * 「今晚 8 点」「23:59 前」「下午 5 点半」→ 'HH:MM'；认不出返回 ''。
   */
  function parseDueTime(text) {
    var s = String(text == null ? '' : text).replace(/[\s　]/g, '');
    if (!s) return '';

    var m = s.match(/(\d{1,2})[:：](\d{2})/);
    if (m) {
      var h0 = Number(m[1]), mi0 = Number(m[2]);
      if (h0 >= 0 && h0 <= 23 && mi0 >= 0 && mi0 <= 59) return pad2(h0) + ':' + pad2(mi0);
    }

    m = s.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上|今晚|明晚)?(\d{1,2})点(半|(\d{1,2})分?)?/);
    if (!m) return '';
    var hh = Number(m[2]);
    var mm = m[3] === '半' ? 30 : (m[4] ? Number(m[4]) : 0);
    var pre = m[1] || '';
    if (/下午|傍晚|晚上|今晚|明晚/.test(pre) && hh < 12) hh += 12;
    if (/凌晨/.test(pre) && hh === 12) hh = 0;
    if (hh < 0 || hh > 23 || mm > 59) return '';
    return pad2(hh) + ':' + pad2(mm);
  }

  /**
   * 「3 小时后」「剩下 5 小时」「40 分钟内」「剩余414小时26分钟」「3 天 5 小时」
   * → {dueOn, dueTime, minutesLeft}；认不出返回 null。
   */
  function parseRelative(text, ctx) {
    var s = String(text == null ? '' : text).replace(/[\s　]/g, '');
    if (!s) return null;
    var now = (ctx && ctx.nowAt) ? new Date(ctx.nowAt) : new Date();
    if (isNaN(now.getTime())) now = new Date();

    // 「414小时26分钟」这种小时+分钟连写的，两段都要算上
    var mCombo = s.match(/([零一二两三四五六七八九十百\d.]{1,5})个?小时([零一二两三四五六七八九十百\d.]{1,3})分(钟)?/);
    if (mCombo) {
      var hh = /^\d+(\.\d+)?$/.test(mCombo[1]) ? Number(mCombo[1]) : cnToInt(mCombo[1]);
      var mm = /^\d+$/.test(mCombo[2]) ? Number(mCombo[2]) : cnToInt(mCombo[2]);
      var total = Math.round((hh || 0) * 60 + (mm || 0));
      if (total > 0) return relFromMinutes(now, total);
    }

    var mins = null;
    var m = s.match(/(半|[零一二两三四五六七八九十百\d.]+)个?小时(之内|以内|内|之后|后)?/);
    if (m) {
      mins = m[1] === '半' ? 30
        : Math.round((/^\d+(\.\d+)?$/.test(m[1]) ? Number(m[1]) : cnToInt(m[1])) * 60);
    }
    if (!mins) {
      var m2 = s.match(/([零一二两三四五六七八九十百\d]+)分钟(之内|以内|内|之后|后)?/);
      if (m2) mins = cnToInt(m2[1]);
    }
    if (!mins) {
      // 「3 天后」这类按整天算的也归到这里，方便统一从「现在」往后推
      var m3 = s.match(/([零一二两三四五六七八九十百\d]{1,3})\s*天(之内|以内|内|之后|后)/);
      if (m3) mins = cnToInt(m3[1]) * 24 * 60;
    }
    if (!mins || mins <= 0) return null;
    if (mins > 60 * 24 * 30) return null; // 一个月以上就不算「几小时后」了
    return relFromMinutes(now, mins);
  }

  function relFromMinutes(now, mins) {
    var dt = new Date(now.getTime() + mins * 60000);
    return {
      dueOn: toISO(dt),
      dueTime: pad2(dt.getHours()) + ':' + pad2(dt.getMinutes()),
      minutesLeft: mins
    };
  }

  function safeISO(y, m, d) {
    if (!(y > 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    var iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var dt = toDate(iso);
    if (dt.getMonth() + 1 !== m || dt.getDate() !== d) return null; // 2 月 30 日这种
    return iso;
  }

  /* ---------- 时长猜测 ---------- */

  function estMinGuess(text) {
    var t = String(text || '');
    if (/论文|报告|大作业|设计|综述/.test(t)) return 60;
    if (/实验|编程|代码|调试/.test(t)) return 45;
    if (/习题|练习|作业|题|课后/.test(t)) return 40;
    if (/预习|复习|阅读|看|读/.test(t)) return 20;
    return 30;
  }

  /* ---------- 提示词 ---------- */

  function buildPrompt(courseNames, today) {
    return [
      '你是学生的作业通知解析器。看图里的文字，把「要学生做的事」一条条列出来。',
      '只输出一个 JSON 对象，不要解释、不要 Markdown 代码块。格式：',
      '{"tasks":[{"course":"课程名","title":"要做什么","dueOn":"YYYY-MM-DD","dueTime":"HH:MM 或空","remain":"剩余时间原话或空","estMin":数字,"raw":"这条对应的原文"}],',
      ' "raw":"整张图里与作业有关的关键原文，不超过 300 字"}',
      '规则：',
      '1. 图里可能同时有好几条作业（例如截图里连着的几行通知、群里连着发的几条）——**每条单独一个对象，全都列出来**，不要合并、不要只挑第一条、不要漏。',
      '2. 最多列 ' + MAX_TASKS + ' 条；排在最前面的放最急的。',
      '3. title 尽量照抄原文的措辞（例如「习题 1.2 第 3-8 题」「实验报告：氧化还原滴定」），不要自己编，也不要加「请」「完成」这类词。',
      '4. course 必须从课程列表里原样挑一个；判断不出就填空字符串，**不要因为课程不确定就把这条丢掉**。',
      '5. dueOn 图里没有就填空字符串，别瞎猜；看到「明天 / 下周三 / 本周五前 / 3 日内」要换算成具体日期。',
      '6. estMin 是整数分钟；估不出来填 30。',
      '7. **截图里写「剩余 414 小时 26 分钟」「还剩 78 小时」这种剩余时间的，把那段话一字不改抄进 remain 字段，dueOn 留空——不要自己换算、不要跳过这条。**',
      '8. 如果整张图里没有任何「要你做的事」（例如只是课本正文、课件标题、闲聊），返回 {"tasks":[]}。',
      '课程列表：' + (courseNames || []).join(' / '),
      '今天是 ' + today + '。'
    ].join('\n');
  }

  function buildMessages(courseNames, today, dataUrl) {
    return [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: buildPrompt(courseNames, today) }
      ]
    }];
  }

  /* 用户自己打的一段字 → 同样的 JSON 契约，只是没有图 */
  function buildTextPrompt(courseNames, today) {
    return buildPrompt(courseNames, today)
      .replace('看图里的文字，把「要学生做的事」一条条列出来',
        '读下面学生自己打的一段话，把「要学生做的事」一条条列出来')
      .replace('{"tasks":[{"course":"课程名","title":"要做什么","dueOn":"YYYY-MM-DD","estMin":数字,"raw":"这条对应的原文"}],',
        '{"tasks":[{"course":"课程名","title":"要做什么","dueOn":"YYYY-MM-DD","dueTime":"HH:MM 或空","estMin":数字,"raw":"这条对应的原文"}],')
      + '\n补充：输入是一段手打的文字，可能一行一条、也可能连着写；「今晚 8 点」「3 小时后」「剩两小时」这类要换算成具体几点（dueTime）；一条都认不出就返回 {"tasks":[]}。';
  }

  function buildTextMessages(text, courseNames, today) {
    return [{
      role: 'user',
      content: buildTextPrompt(courseNames, today) + '\n\n要解析的文字：\n' + String(text == null ? '' : text).slice(0, 1500)
    }];
  }

  /* ---------- 模型返回清洗 ---------- */

  /** 从可能夹着废话的文本里抠出第一个 JSON 对象 */
  function extractJSON(text) {
    if (text && typeof text === 'object') return text;
    var s = String(text == null ? '' : text).trim();
    if (!s) return null;
    // 去掉 ```json ``` 包裹
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (e) { /* 继续尝试 */ }

    var start = s.indexOf('{');
    if (start < 0) return null;
    var depth = 0;
    var inStr = false;
    var esc = false;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; }
        }
      }
    }
    return null;
  }

  /** 模型回答被截断时，把还完整的那些任务对象抢回来（比整份丢掉强） */
  function salvageTasks(text) {
    var s = String(text == null ? '' : text);
    var objs = [];
    var re = /\{[^{}]*\}/g;
    var m;
    while ((m = re.exec(s))) {
      try {
        var o = JSON.parse(m[0]);
        if (o && (o.title || o.name || o.content)) objs.push(o);
      } catch (e) { /* 半截对象，跳过 */ }
    }
    var topRaw = '';
    var rm = s.match(/"raw"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (rm) { try { topRaw = JSON.parse('"' + rm[1] + '"'); } catch (e) { topRaw = rm[1]; } }
    if (!objs.length && !topRaw) return null;
    return { tasks: objs, raw: topRaw, __salvaged: true };
  }

  /** 「未交」「剩余 414 小时 26 分钟」这类行不是任务，是上一条任务的线索 */
  function isMetaLine(line) {
    if (/^(?:未交|未提交|未完成|已完成|已提交|已交|进行中|待完成|剩余)/.test(line)) return true;
    if (/(剩余|还剩|倒计时)\s*[:：]?/.test(line) && line.length <= 30) return true;
    return false;
  }

  /**
   * 兜底：模型没给出干净 JSON（或者干脆说「不知道要干什么」）时，
   * 把图里认到的原文切成候选行，让用户改个标题就能入库——而不是弹一个死胡同。
   * 注意：截图里「标题一行、未交/剩余时间另起一行」很常见，
   * 所以要把它当成上一条的日期线索，而不是又一条任务。
   */
  function fallbackTasks(text, ctx) {
    ctx = ctx || {};
    var today = ctx.today || toISO(new Date());
    var courses = ctx.courses || [];
    var s = String(text == null ? '' : text)
      .replace(/```[a-zA-Z]*\n?/g, '\n')
      .replace(/[{}\[\]"]/g, '\n');
    var parts = s.split(/[\n\r]+/);
    var out = [];
    var seen = {};
    for (var i = 0; i < parts.length && out.length < MAX_TASKS; i++) {
      var segs = String(parts[i]).split(/[；;。]\s*/);
      for (var j = 0; j < segs.length && out.length < MAX_TASKS; j++) {
        var line = segs[j]
          .replace(/^\s*(?:[-*·•]|\(?\d+[).、]|[①-⑩]|[一二三四五六七八九十]+[、.])[\s、.]*/, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (line.length < 2) continue;

        /* 「未交」「剩余 414 小时 26 分钟」这类行是上一条的日期线索，不是新任务 */
        if (isMetaLine(line)) {
          var last = out[out.length - 1];
          if (last) {
            var relMeta = parseRelative(line, ctx) || (parseDueDate(line, today) ? { dueOn: parseDueDate(line, today) } : null);
            if (relMeta && relMeta.dueOn && (!last.dueOn || last.dueOnAuto)) {
              last.dueOn = relMeta.dueOn;
              last.dueTime = relMeta.dueTime || '';
              last.dueOnAuto = false;
            }
            last.meta = (last.meta ? last.meta + ' ' : '') + line;
          }
          continue;
        }

        if (line.length > 60) continue;
        if (/^(?:isTask|tasks?|title|course|dueOn|dueTime|estMin|raw|remain|countdown)\b/.test(line)) continue;
        if (/^[\s:,;.!?~—\-]/.test(line)) continue;                       /* JSON 残渣，例如 ":true" */
        if (/^(?:true|false|null|nil|ok|okay|yes|no|none|\d+)$/i.test(line)) continue;
        var key = line.replace(/\s/g, '');
        if (seen[key]) continue;
        seen[key] = 1;
        var course = matchCourse(line, courses);
        var rel = parseRelative(line, ctx);
        var dueAbs = parseDueDate(line, today);
        out.push({
          courseId: course ? course.id : '',
          courseName: course ? course.name : '',
          title: line.slice(0, MAX_TITLE),
          dueOn: (dueAbs || (rel && rel.dueOn)) || '',
          dueTime: (dueAbs ? '' : (rel && rel.dueTime)) || '',
          dueOnAuto: !(dueAbs || rel),
          estMin: estMinGuess(line)
        });
      }
    }

    /* 仍然没有日期的，回头在整段原文里找它那一行下面的「剩余…」 */
    var all = String(text || '');
    out.forEach(function (t) {
      if (t.dueOn || !t.title) return;
      var idx = all.indexOf(t.title.slice(0, 8));
      if (idx < 0) return;
      var windowText = all.slice(idx, idx + 120);
      var rel = parseRelative(windowText, ctx) || (parseDueDate(windowText, today) ? { dueOn: parseDueDate(windowText, today) } : null);
      if (rel && rel.dueOn) { t.dueOn = rel.dueOn; t.dueTime = rel.dueTime || ''; t.dueOnAuto = false; }
    });

    return out;
  }

  /** 模型可能给 {tasks:[]} / {task:{}} / 数组 / 单个对象，统一抽成数组 */
  function pickTaskArray(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return obj;
    if (Array.isArray(obj.tasks)) return obj.tasks;
    if (obj.task && typeof obj.task === 'object') return [obj.task];
    if (obj.title || obj.courseName || obj.course) return [obj];
    return [];
  }

  /** 归一单条：补课程、补截止日、补时长；collect 里收集提示语 */
  function normalizeOne(obj, ctx, collect, no) {
    if (!obj || typeof obj !== 'object') return null;
    var today = ctx.today;
    var courses = ctx.courses;
    var pre = no ? '第 ' + no + ' 条：' : '';

    var title = String(obj.title || obj.name || obj.content || '')
      .replace(/[\s　]+/g, ' ').trim();
    if (!title && obj.raw) title = String(obj.raw).trim();
    if (!title) return null;
    if (title.length > MAX_TITLE) title = title.slice(0, MAX_TITLE);

    var course = null;
    if (obj.course || obj.courseName) {
      var want = clean(String(obj.course || obj.courseName));
      for (var i = 0; i < courses.length; i++) {
        if (clean(courses[i].name) === want) { course = courses[i]; break; }
      }
      if (!course) {
        course = matchCourse(String(obj.course || obj.courseName) + ' ' + title + ' ' + (obj.raw || ''), courses);
      }
    } else {
      course = matchCourse(title + ' ' + (obj.raw || ''), courses);
    }
    if (!course) collect.push(pre + '没判断出是哪门课，请选一下');

    /* 日期优先级：模型给的绝对日期 > 模型给的剩余时间/「70 小时后」> 原文里的相对时间 > 原文里的日期 > 明天 */
    var remainText = String(obj.remain || '') + ' ' + String(obj.countdown || '');
    var relRemain = parseRelative(remainText, ctx);
    var relModel = parseRelative(String(obj.dueOn || ''), ctx);
    var relRaw = parseRelative(String(obj.raw || ''), ctx);
    var rel = relRemain || relModel || relRaw;
    var dueOn = parseDueDate(obj.dueOn || '', today);
    if (!dueOn && rel) dueOn = rel.dueOn;
    if (!dueOn && obj.dueOn) {
      collect.push(pre + '截止日期没看懂（原文：' + String(obj.dueOn).slice(0, 20) + '），先按明天算');
    }
    if (!dueOn) dueOn = parseDueDate(obj.raw || '', today);
    /* 「默认明天」的提示推迟到救援之后再说：可能能从原文的剩余时间里算出来 */
    if (dueOn && diffDays(today, dueOn) < 0) {
      collect.push(pre + '识别出的日期已经过去，改成明天');
      dueOn = addDays(today, 1);
      rel = null;
    }
    var dueGuessed = false;
    if (!dueOn) { dueOn = addDays(today, 1); dueGuessed = true; }

    /* 具体几点：模型给了就用它的，没给就从原文里找 */
    var dueTime = parseDueTime(String(obj.dueTime || '')) || (rel && rel.dueTime) ||
      parseDueTime(obj.dueOn || '') || parseDueTime(obj.raw || '');
    if (diffDays(today, dueOn) < 0) dueTime = '';

    var estMin = Number(obj.estMin);
    if (!isFinite(estMin) || estMin <= 0) estMin = estMinGuess(title);
    estMin = Math.max(5, Math.min(240, Math.round(estMin)));

    return {
      courseId: course ? course.id : '',
      courseName: course ? course.name : '',
      title: title,
      dueOn: dueOn,
      dueTime: dueTime,
      dueGuessed: dueGuessed,
      estMin: estMin
    };
  }

  /**
   * 把模型的回答洗成可入库的任务列表。
   * 返回 { ok, draft, reason, tasks, warnings, raw }
   *   tasks: [{ courseId, courseName, title, dueOn, estMin }]
   *   draft: true 表示这是兜底草稿（模型没给准话，内容取自原文），需要用户改
   */
  function normalizeResult(modelText, ctx) {
    ctx = ctx || {};
    var today = ctx.today || toISO(new Date());
    var courses = ctx.courses || [];
    var obj = extractJSON(modelText);
    var raw = '';
    var warnings = [];
    var tasks = [];

    /* 回答被 max_tokens 截断时，整份 JSON 解析不出来，但前半段往往是完整的：
       把还完整的任务对象抢回来，比退化成「按行猜」强得多 */
    if (!obj) {
      var salv = salvageTasks(modelText);
      if (salv && (salv.tasks.length || salv.raw)) {
        obj = salv;
        warnings.push('模型的回答被截断了（图里作业太多），我抢回了还能用的部分——漏掉的手动补一条');
      }
    }

    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      raw = String(obj.raw || obj.text || '').slice(0, 400);
    }

    var arr = pickTaskArray(obj);
    for (var i = 0; i < arr.length && tasks.length < MAX_TASKS; i++) {
      var t = normalizeOne(arr[i], { today: today, courses: courses, nowAt: ctx.nowAt }, warnings, arr.length > 1 ? i + 1 : 0);
      if (t) tasks.push(t);
    }

    /* 后置救援：模型常常把整屏原文放在顶层 raw、单条任务里不给日期。
       谁没有日期，就去 raw 里找它那一行（及其后两行）自己算。 */
    var rescuedN = 0;
    if (raw && tasks.length) {
      tasks.forEach(function (tk) {
        if (tk.dueOn && !tk.dueGuessed) return;   /* 已经算出确切日期就不动 */
        var probe = String(tk.title || '').slice(0, 6);
        if (probe.length < 2) return;
        var idx = raw.indexOf(probe);
        if (idx < 0) return;
        var chunk = raw.slice(idx, idx + 120);
        var rel = parseRelative(chunk, ctx) || (parseDueDate(chunk, today) ? { dueOn: parseDueDate(chunk, today) } : null);
        if (rel && rel.dueOn) {
          tk.dueOn = rel.dueOn;
          tk.dueTime = tk.dueTime || rel.dueTime || '';
          tk.dueGuessed = false;
          rescuedN++;
        }
      });
    }

    if (rescuedN) {
      warnings.push((rescuedN > 1 ? rescuedN + ' 条作业的截止时间' : '截止时间') +
        '是按图里的剩余时间算的（可能差几分钟），核对一下');
    }

    /* 救援之后仍然没有日期的，才提示「默认明天」 */
    tasks.forEach(function (tk, i) {
      if (tk.dueGuessed) {
        warnings.push((tasks.length > 1 ? '第 ' + (i + 1) + ' 条：' : '') + '图里没写截止日期，默认明天');
      }
      delete tk.dueGuessed;
    });

    if (tasks.length) {
      return {
        ok: true, draft: false, reason: 'ok',
        tasks: tasks, task: tasks[0], warnings: warnings, raw: raw
      };
    }

    /* 到这里说明模型没给出能用的条目：说「没有任务」、全是空标题、或者压根没给 JSON。
       不管哪种，只要图里有字，就先摊成草稿让用户改。 */
    var drafts = fallbackTasks(raw || modelText, { today: today, courses: courses });
    var why = !obj ? 'not-json'
      : (obj && obj.isTask === false) ? 'no-task'
      : 'no-title';

    if (drafts.length) {
      return {
        ok: true,
        draft: true,
        reason: why,
        tasks: drafts,
        task: drafts[0],
        warnings: ['模型没给出明确结论，先把图里认到的内容按行列出来了——点一条、改改标题就能用'],
        raw: raw || String(modelText || '').slice(0, 400)
      };
    }

    var msg = why === 'not-json' ? '模型没按格式回答'
      : why === 'no-task' ? '图里没找到要你做的事'
      : '认出了字，但没凑出一条完整的事';
    return {
      ok: false,
      draft: false,
      reason: why,
      tasks: [],
      warnings: [msg + '，可以直接手填一条'],
      raw: raw || (obj ? '' : String(modelText || '').slice(0, 400))
    };
  }

  /* ---------- 合并：本地规则 vs 模型 ----------
     原则：本地规则是「确定性算出来的」，用户点「认一下」之前在预览里看到的就是它，
     所以只要本地认出了东西，科目 / 标题 / 截止时间都以本地为准；
     模型只用来补本地漏掉的信息和覆盖本地完全认不出的情况。
     两边时间不一致时明说出来，别让用户以为是随机的。 */
  function mergeResults(local, api) {
    var warns = [];

    if (!api || !api.tasks || !api.tasks.length) return local;
    if (!local || !local.ok || !local.tasks || !local.tasks.length) return api;

    if (local.tasks.length !== api.tasks.length) {
      warns.push('模型分成 ' + api.tasks.length + ' 条，本地规则分成 ' + local.tasks.length +
        ' 条；先按本地规则来，漏的删/补一下就行');
      var only = cloneResult(local);
      only.warnings = (only.warnings || []).concat(warns);
      return only;
    }

    var out = [];
    for (var i = 0; i < local.tasks.length; i++) {
      var L = local.tasks[i];
      var A = api.tasks[i];
      var t = {
        courseId: L.courseId || A.courseId,
        courseName: L.courseName || A.courseName,
        title: L.title || A.title,
        dueOn: L.dueOn || A.dueOn,
        dueTime: L.dueTime || A.dueTime,
        estMin: A.estMin || L.estMin,
        raw: L.raw || A.raw
      };
      if (L.dueOn && A.dueOn && L.dueOn !== A.dueOn) {
        warns.push('「' + (L.title || '') + '」模型算成 ' + cnDate(A.dueOn) +
          '，我按本地规则填了 ' + cnDate(L.dueOn) + '（点日期框能改）');
      }
      out.push(t);
    }

    var res = {
      ok: true,
      draft: false,
      reason: 'merged',
      tasks: out,
      task: out[0],
      warnings: (api.warnings || []).concat(local.warnings || []).concat(warns),
      raw: local.raw || api.raw
    };
    return res;
  }

  /** 2026-10-22 → 10月22日 */
  function cnDate(iso) {
    var d = toDate(iso);
    if (!d) return String(iso || '');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function cloneResult(r) {
    return {
      ok: r.ok, draft: r.draft, reason: r.reason,
      tasks: (r.tasks || []).slice(), task: r.task,
      warnings: (r.warnings || []).slice(), raw: r.raw
    };
  }

  /* ---------- 纯文字解析：不联网、不花 Key ---------- */

  /** 课程名 → 它所有的口语别名（用于从标题里把课程名摘掉） */
  function aliasOf(name) {
    var out = [];
    var n = clean(name);
    if (!n) return out;
    ALIAS.forEach(function (p) {
      if (n.indexOf(clean(p[1])) >= 0) out.push(p[0]);
    });
    return out;
  }

  /** 从一句话里摘掉日期、课程名、口头语，留下「要做的事」 */
  function titleFromText(seg, course) {
    var s = String(seg == null ? '' : seg);

    // 日期表达
    s = s.replace(/20\d{2}\s*[-/年.]\s*\d{1,2}\s*[-/月.]\s*\d{1,2}\s*日?/g, ' ');
    s = s.replace(/\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?/g, ' ');
    s = s.replace(/(这|本|下{1,2})?\s*(个)?\s*(周|星期|礼拜)\s*[一二三四五六日天]/g, ' ');
    s = s.replace(/(这|本|下{1,2})\s*(个)?\s*(周|星期|礼拜)(内|之前|前)?/g, ' ');
    s = s.replace(/(今天|今晚|今日|大后天|后天|明天|明日)/g, ' ');
    s = s.replace(/[一二三四五六七八九十\d]{1,3}\s*(日|天)内/g, ' ');
    s = s.replace(/[零一二两三四五六七八九十百\d]{1,3}\s*天(之内|以内|内|之后|后)/g, ' ');
    s = s.replace(/半个月(之内|以内|内|之后|后)?/g, ' ');
    s = s.replace(/(一|两|二)?周(之内|以内|内|之后|后)/g, ' ');
    // 几点、几小时后、剩多久
    s = s.replace(/(凌晨|早上|上午|中午|下午|傍晚|晚上|今晚|明晚)?\s*\d{1,2}\s*[点:：]\s*(\d{1,2}\s*分?|半)?/g, ' ');
    s = s.replace(/剩(下|余)?\s*[零一二两三四五六七八九十百\d.]+\s*(个)?\s*(小时|分钟)/g, ' ');
    s = s.replace(/[零一二两三四五六七八九十百\d.]+\s*个?\s*小时(之内|以内|内|之后|后)?/g, ' ');
    s = s.replace(/[零一二两三四五六七八九十百\d.]+\s*分钟(之内|以内|内|之后|后)?/g, ' ');
    s = s.replace(/(剩余|还剩|还剩下|剩余时间|倒计时)[\s:：]*/g, ' ');
    s = s.replace(/(未交|已完成|已交|未完成)[\s:：]*/g, ' ');

    // 口头语与动词
    s = s.replace(/^(要|得|需|需要|记得|别忘了|帮我|我|作业|任务|请大家)[\s:：]*/g, '');
    s = s.replace(/(之前|以前)\s*(交|提交|上交|完成|做完)?/g, ' ');
    s = s.replace(/(前|之前|以前)?\s*(交|提交|上交|截止|deadline)\s*$/gi, ' ');
    s = s.replace(/^\s*(交|提交|上交)\s*/g, ' ');
    s = tidy(s);

    // 课程名和别名：挨个试着摘，挑「摘得最干净但仍说得清」的那个
    // （「大物实验报告」→「实验报告」好过原样留着；「英语作文」→「作文」就该拦住）
    if (course) {
      var base = s;
      var best = '';
      var names = [course.name].concat(aliasOf(course.name));
      var all = names.map(function (n) { return String(n || '').trim(); })
        .filter(function (n) { return n.length >= 2; });
      names.forEach(function (n) {
        var raw = String(n || '').trim();
        if (raw.length < 2) return;
        var cands = [raw];
        /* 短别名：只有当它不是某个更长别名的前半截时才用，
           否则「C语言作业」会被「C语」切成「言作业」 */
        if (raw.length > 2) {
          var head = raw.slice(0, 2);
          var shadowed = all.some(function (l) {
            return l.length > head.length &&
              l.toLowerCase().indexOf(head.toLowerCase()) === 0 &&
              base.toLowerCase().indexOf(l.toLowerCase()) >= 0;
          });
          if (!shadowed) cands.push(head);
        }
        cands.forEach(function (c) {
          var q = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (!q) return;
          var t = tidy(base.replace(new RegExp(q, 'gi'), ' '));
          /* 摘完只剩一两个字就别摘了，留着原话更好认 */
          var minLen = 3;
          if (t.length >= minLen && t !== base && (!best || t.length < best.length)) best = t;
        });
      });
      if (best) s = best;
    }

    return s.slice(0, MAX_TITLE);
  }

  function tidy(s) {
    return String(s)
      .replace(/^[\s,，。、;；:：\-—·~～]+|[\s,，。、;；:：\-—·~～]+$/g, '')
      .replace(/[（(]\s*[）)]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /** 把一段文字切成一条一条的句子 */
  function splitSegments(text) {
    var s = String(text == null ? '' : text).replace(/\r/g, '');
    // 编号列表（1. / 2、/ 3)）当作分行
    s = s.replace(/(^|[\n;；])\s*\d{1,2}\s*[.、)）]\s*/g, '\n');
    var out = [];
    s.split(/\n|;|；/).forEach(function (line) {
      line = line.trim();
      if (line) out.push(line);
    });
    return out;
  }

  /**
   * 用户自己打/粘一段文字 → 直接解析成作业条目。
   * 返回结构与 normalizeResult 一致：{ ok, draft, reason, tasks, warnings, raw }
   */
  function parseText(text, ctx) {
    ctx = ctx || {};
    var today = ctx.today || toISO(new Date());
    var courses = ctx.courses || [];
    var raw = String(text == null ? '' : text).slice(0, 400);
    var warnings = [];
    var tasks = [];
    var flat = [];

    // 一句话里塞了两门课时，再按逗号拆开
    splitSegments(text).forEach(function (seg) {
      var hits = 0;
      courses.forEach(function (c) { if (matchCourse(seg, [c])) hits++; });
      if (hits < 2) {
        flat.push(seg);
      } else {
        seg.split(/[,，、]/).forEach(function (p) {
          if (p.trim()) flat.push(p.trim());
        });
      }
    });

    flat.forEach(function (seg, idx) {
      if (tasks.length >= MAX_TASKS) return;
      var course = matchCourse(seg, courses);
      var rel = parseRelative(seg, ctx);
      var dueOn = rel ? rel.dueOn : parseDueDate(seg, today);
      var dueTime = rel ? rel.dueTime : parseDueTime(seg);
      var title = titleFromText(seg, course) || String(seg).slice(0, MAX_TITLE);
      var pre = flat.length > 1 ? '第 ' + (idx + 1) + ' 条：' : '';

      if (!course) warnings.push(pre + '没认出是哪门课，先选了「不确定」，你改一下');
      if (!dueOn) {
        warnings.push(pre + '没写截止日期，先按明天算');
        dueOn = addDays(today, 1);
      } else if (diffDays(today, dueOn) < 0) {
        warnings.push(pre + '写的日期已经过去了，改成明天');
        dueOn = addDays(today, 1);
        dueTime = '';
      }

      tasks.push({
        courseId: course ? course.id : '',
        courseName: course ? course.name : '',
        title: title,
        dueOn: dueOn,
        dueTime: dueTime || '',
        estMin: estMinGuess(title)
      });
    });

    if (!tasks.length) {
      return {
        ok: false,
        draft: false,
        reason: 'no-task',
        tasks: [],
        warnings: ['这段文字里没找到能当作业的内容，多写几个字试试'],
        raw: raw
      };
    }
    return { ok: true, draft: false, tasks: tasks, warnings: warnings, raw: raw };
  }

  /* ---------- 请求体 / 错误归因 ---------- */

  /* 智谱对 max_tokens 有上限（glm-4v-flash 只允许 1~1024），写 1500 会直接被拒 */
  var MAX_TOKENS = 1024;

  function buildRequestBody(model, messages, opts) {
    opts = opts || {};
    var mt = Number(opts.maxTokens) || MAX_TOKENS;
    if (mt > MAX_TOKENS) mt = MAX_TOKENS;
    if (mt < 1) mt = MAX_TOKENS;
    return {
      model: model || 'glm-4v-flash',
      messages: messages,
      temperature: 0.1,
      stream: false,
      max_tokens: mt
    };
  }

  /** 把 HTTP/网络错误翻译成给用户看的一句话（带上原始信息，方便排查） */
  function explainError(status, bodyText) {
    var body = String(bodyText || '');
    var m = body.match(/"message"\s*:\s*"([^"]{1,160})"/);
    var apiMsg = m ? m[1] : '';
    var tail = apiMsg ? '（' + apiMsg + '）' : '';
    if (status === 0) return '连不上模型服务：网络不通、被墙，或浏览器拦了跨域';
    if (status === 401) return 'Key 不对或已过期，去设置里重填' + tail;
    if (status === 403) return '这个 Key 没有调用权限（可能没实名/没开通）' + tail;
    if (status === 429) return '请求太频繁或免费额度用完了，等一会儿再试' + tail;
    if (status === 404) return '模型名不对，去设置里换成 glm-4v-plus 再试' + tail;
    if (status === 413) return '这张图太大，换一张或裁小一点';
    if (status >= 500) return '模型服务自己出错了（HTTP ' + status + '），等几分钟再试' + tail;
    if (/max_tokens/i.test(apiMsg + body)) return '这次请求的参数被拒（max_tokens 超范围）' + tail;
    if (/content|图片|image|size|illegal|base64/i.test(apiMsg)) return '这张图模型读不了（太大或格式不支持），换一张或裁小一点' + tail;
    if (apiMsg) return '模型返回错误（HTTP ' + status + '）：' + apiMsg;
    var snip = body.replace(/\s+/g, ' ').slice(0, 120);
    return '识别失败（HTTP ' + status + '）' + (snip ? '：' + snip : '');
  }

  return {
    toDate: toDate,
    toISO: toISO,
    addDays: addDays,
    isoWeekday: isoWeekday,
    diffDays: diffDays,
    clean: clean,
    matchCourse: matchCourse,
    parseDueDate: parseDueDate,
    parseDueTime: parseDueTime,
    parseRelative: parseRelative,
    estMinGuess: estMinGuess,
    buildPrompt: buildPrompt,
    buildMessages: buildMessages,
    buildTextPrompt: buildTextPrompt,
    buildTextMessages: buildTextMessages,
    buildRequestBody: buildRequestBody,
    extractJSON: extractJSON,
    normalizeResult: normalizeResult,
    mergeResults: mergeResults,
    normalizeOne: normalizeOne,
    pickTaskArray: pickTaskArray,
    fallbackTasks: fallbackTasks,
    explainError: explainError,
    parseText: parseText,
    titleFromText: titleFromText,
    splitSegments: splitSegments,
    ALIAS: ALIAS
  };
});
