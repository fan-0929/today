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
      '你是学生的作业通知解析器。看图片里的文字，判断它是不是一条「要我做点什么」的作业/任务通知。',
      '只输出一个 JSON 对象，不要解释、不要 Markdown 代码块。字段：',
      '{"isTask": true 或 false,',
      ' "course": "课程名，必须从下面的列表里原样挑一个；判断不出填空字符串",',
      ' "title": "要做什么，动词开头，不超过 40 字",',
      ' "dueOn": "YYYY-MM-DD；图里没有截止日期填空字符串",',
      ' "estMin": 预计需要多少分钟的整数,',
      ' "raw": "与作业有关的关键原文，不超过 80 字"}',
      '课程列表：' + (courseNames || []).join(' / '),
      '今天是 ' + today + '。看到「明天 / 下周三 / 本周五前 / 3 日内」这类写法，换算成具体日期。',
      '如果图里只是课本页面、课件标题、聊天闲话，没有具体要求你做的事，isTask 填 false。'
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
   * 把模型的回答洗成可入库的任务。
   * 返回 { ok, reason, task, warnings }
   *   task: { courseId, courseName, title, dueOn, estMin, raw }
   */
  function normalizeResult(modelText, ctx) {
    ctx = ctx || {};
    var today = ctx.today || toISO(new Date());
    var courses = ctx.courses || [];
    var warnings = [];

    var obj = extractJSON(modelText);
    if (!obj) {
      return { ok: false, reason: 'not-json', warnings: ['模型没按格式回答'], raw: String(modelText || '').slice(0, 200) };
    }
    if (obj.isTask === false) {
      return { ok: false, reason: 'no-task', warnings: ['图里没看出要做的事'], raw: String(obj.raw || '').slice(0, 200) };
    }

    var title = String(obj.title || '').replace(/[\s　]+/g, ' ').trim();
    if (!title && obj.raw) title = String(obj.raw).trim();
    if (!title) {
      return { ok: false, reason: 'no-title', warnings: ['没认出要做什么，请手动填'], raw: '' };
    }
    if (title.length > MAX_TITLE) title = title.slice(0, MAX_TITLE);

    var course = null;
    var byName = null;
    if (obj.course) {
      for (var i = 0; i < courses.length; i++) {
        if (clean(courses[i].name) === clean(obj.course)) { byName = courses[i]; break; }
      }
      course = byName || matchCourse(String(obj.course) + ' ' + title + ' ' + (obj.raw || ''), courses);
    } else {
      course = matchCourse(title + ' ' + (obj.raw || ''), courses);
    }
    if (!course) warnings.push('没判断出是哪门课，请选一下');

    var dueOn = obj.dueOn ? parseDueDate(obj.dueOn, today) : null;
    if (obj.dueOn && !dueOn) warnings.push('截止日期没看懂（原文：' + String(obj.dueOn).slice(0, 20) + '），默认明天');
    if (!obj.dueOn) {
      var fromRaw = parseDueDate(obj.raw || '', today);
      dueOn = fromRaw;
      if (!fromRaw) warnings.push('图里没写截止日期，默认明天');
    }
    if (dueOn && diffDays(today, dueOn) < 0) {
      warnings.push('识别出的日期已经过去了，已改成明天');
      dueOn = addDays(today, 1);
    }
    if (!dueOn) dueOn = addDays(today, 1);

    var estMin = Number(obj.estMin);
    if (!isFinite(estMin) || estMin <= 0) estMin = estMinGuess(title);
    estMin = Math.max(5, Math.min(240, Math.round(estMin)));

    return {
      ok: true,
      reason: 'ok',
      warnings: warnings,
      raw: String(obj.raw || '').slice(0, 200),
      task: {
        courseId: course ? course.id : '',
        courseName: course ? course.name : '',
        title: title,
        dueOn: dueOn,
        estMin: estMin
      }
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
      max_tokens: opts.maxTokens || 800
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
    explainError: explainError,
    ALIAS: ALIAS
  };
});
