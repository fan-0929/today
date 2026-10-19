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
    ['高数', '高等数学'], ['高等数学', '高等数学'],
    ['c语言', '程序设计'], ['c 语言', '程序设计'], ['编程', '程序设计'], ['程序设计', '程序设计'],
    ['大物实验', '大学物理实验'], ['物理实验', '大学物理实验'],
    ['大物', '大学物理'], ['大学物理', '大学物理'],
    ['化学实验', '大学化学实验'],
    ['大化', '大学化学'], ['大学化学', '大学化学'],
    ['思修', '思想道德'], ['思想道德', '思想道德'], ['思政', '思想道德'],
    ['英语', '大学英语'], ['大英', '大学英语'],
    ['体育', '体育'], ['保健班', '体育'],
    ['国安', '国家安全'], ['国家安全', '国家安全'],
    ['犯罪', '犯罪与预防'],
    ['形政', '形势与政策'], ['形势', '形势与政策'],
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
      (courses || []).forEach(function (c) {
        if (clean(c.name).indexOf(clean(pair[1])) >= 0) {
          var s = 0.9;
          if (!best || s > best.score) best = { course: c, score: s };
        }
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

    if (/一周内|一周之内|本周内/.test(s)) return addDays(today, 7);
    return null;
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
      '{"tasks":[{"course":"课程名","title":"要做什么","dueOn":"YYYY-MM-DD","estMin":数字,"raw":"这条对应的原文"}],',
      ' "raw":"整张图里与作业有关的关键原文，不超过 300 字"}',
      '规则：',
      '1. 图里可能同时有好几条作业（例如截图里连着的几行通知、群里连着发的几条）——**每条单独一个对象，全都列出来**，不要合并、不要只挑第一条、不要漏。',
      '2. 最多列 ' + MAX_TASKS + ' 条；排在最前面的放最急的。',
      '3. title 尽量照抄原文的措辞（例如「习题 1.2 第 3-8 题」「实验报告：氧化还原滴定」），不要自己编，也不要加「请」「完成」这类词。',
      '4. course 必须从课程列表里原样挑一个；判断不出就填空字符串，**不要因为课程不确定就把这条丢掉**。',
      '5. dueOn 图里没有就填空字符串，别瞎猜；看到「明天 / 下周三 / 本周五前 / 3 日内」要换算成具体日期。',
      '6. estMin 是整数分钟；估不出来填 30。',
      '7. 如果整张图里没有任何「要你做的事」（例如只是课本正文、课件标题、闲聊），返回 {"tasks":[]}。',
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

  /**
   * 兜底：模型没给出干净 JSON（或者干脆说「不知道要干什么」）时，
   * 把图里认到的原文切成候选行，让用户改个标题就能入库——而不是弹一个死胡同。
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
        if (line.length < 3 || line.length > 60) continue;
        if (/^(?:isTask|tasks?|title|course|dueOn|estMin|raw)\b/.test(line)) continue;
        if (/^[\s:,;.!?~—\-]/.test(line)) continue;                       /* JSON 残渣，例如 ":true" */
        if (/^(?:true|false|null|nil|ok|okay|yes|no|none|\d+)$/i.test(line)) continue;
        var key = line.replace(/\s/g, '');
        if (seen[key]) continue;
        seen[key] = 1;
        var course = matchCourse(line, courses);
        out.push({
          courseId: course ? course.id : '',
          courseName: course ? course.name : '',
          title: line.slice(0, MAX_TITLE),
          dueOn: parseDueDate(line, today) || '',
          estMin: estMinGuess(line)
        });
      }
    }
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

    var dueOn = obj.dueOn ? parseDueDate(obj.dueOn, today) : null;
    if (obj.dueOn && !dueOn) {
      collect.push(pre + '截止日期没看懂（原文：' + String(obj.dueOn).slice(0, 20) + '），先按明天算');
    }
    if (!dueOn) dueOn = parseDueDate(obj.raw || '', today);
    if (!obj.dueOn && !dueOn) collect.push(pre + '图里没写截止日期，默认明天');
    if (dueOn && diffDays(today, dueOn) < 0) {
      collect.push(pre + '识别出的日期已经过去，改成明天');
      dueOn = addDays(today, 1);
    }
    if (!dueOn) dueOn = addDays(today, 1);

    var estMin = Number(obj.estMin);
    if (!isFinite(estMin) || estMin <= 0) estMin = estMinGuess(title);
    estMin = Math.max(5, Math.min(240, Math.round(estMin)));

    return {
      courseId: course ? course.id : '',
      courseName: course ? course.name : '',
      title: title,
      dueOn: dueOn,
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

    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      raw = String(obj.raw || obj.text || '').slice(0, 400);
    }

    var arr = pickTaskArray(obj);
    for (var i = 0; i < arr.length && tasks.length < MAX_TASKS; i++) {
      var t = normalizeOne(arr[i], { today: today, courses: courses }, warnings, arr.length > 1 ? i + 1 : 0);
      if (t) tasks.push(t);
    }

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

  /* ---------- 请求体 / 错误归因 ---------- */

  function buildRequestBody(model, messages, opts) {
    opts = opts || {};
    return {
      model: model || 'glm-4v-flash',
      messages: messages,
      temperature: 0.1,
      stream: false,
      max_tokens: opts.maxTokens || 1500
    };
  }

  /** 把 HTTP/网络错误翻译成给用户看的一句话 */
  function explainError(status, bodyText) {
    var body = String(bodyText || '');
    if (status === 0) return '连不上模型服务（网络不通或超时）';
    if (status === 401 || status === 403) return 'Key 无效或没有权限，去设置里重填';
    if (status === 429) return '请求太频繁或额度用完了，等一会儿再试';
    if (status === 404) return '模型名不对，去设置里换成 glm-4v-plus 试试';
    if (status >= 500) return '模型服务自己出错了（' + status + '），稍后再试';
    var m = body.match(/"message"\s*:\s*"([^"]{1,120})"/);
    return m ? '模型返回错误：' + m[1] : '识别失败（HTTP ' + status + '）';
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
    estMinGuess: estMinGuess,
    buildPrompt: buildPrompt,
    buildMessages: buildMessages,
    buildRequestBody: buildRequestBody,
    extractJSON: extractJSON,
    normalizeResult: normalizeResult,
    normalizeOne: normalizeOne,
    pickTaskArray: pickTaskArray,
    fallbackTasks: fallbackTasks,
    explainError: explainError,
    ALIAS: ALIAS
  };
});
