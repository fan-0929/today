/* 今日任务决策器 · 种子数据
 * 数据来源：教务处《范博源(2026-2027-秋)课表.pdf》（打印时间 2026-10-16，2 页）
 * 课表只给了「星期 + 节次 + 周次 + 地点 + 教师」，没给教学大纲，
 * 所以每门课的大纲章节是我按常见教材的顺序 + 每周课次数估算的，
 * 课次总和 ≈ 该课全学期实际课次数，保证不会三周就把大纲讲完。
 * 大纲可在界面上改（设置 → 编辑大纲），或直接改这个文件。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Seed = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 第 1 周的周一。课表 PDF 没写开学日，这是按「9 月第一周开学」的常见校历推的，
     界面上暴露成可改项：周次不对就改这一个日期。 */
  var TERM_START = '2026-09-07';

  var META = {
    term: '2026-2027 学年 秋学期',
    campus: '宝山主区',
    source: '教务处课表导出（2026-10-16 打印）'
  };

  /* slots 里的 weeks / fromWeek / toWeek 直接照抄课表的周次说明：
     「1-16周」→ fromWeek:1,toWeek:16；「9-16周」→ 9/16；「4周,8周,12周,16周」→ weeks:[4,8,12,16] */
  var COURSES = [
    {
      id: 'c-lang',
      name: '程序设计(C语言)',
      code: 'GBK1200001',
      teacher: '宋波',
      place: 'D415',
      credit: 3,
      color: '#2f6b4f',
      slots: [
        { day: 1, period: '第1-2节', fromWeek: 1, toWeek: 16 },
        { day: 3, period: '第1-2节', fromWeek: 1, toWeek: 16 }
      ],
      outline: [
        { id: 'c1', title: '第1章 程序设计与C语言', sessions: 2 },
        { id: 'c2', title: '第2章 数据类型、运算符与表达式', sessions: 4 },
        { id: 'c3', title: '第3章 顺序结构程序设计', sessions: 3 },
        { id: 'c4', title: '第4章 选择结构程序设计', sessions: 4 },
        { id: 'c5', title: '第5章 循环结构程序设计', sessions: 5 },
        { id: 'c6', title: '第6章 数组', sessions: 5 },
        { id: 'c7', title: '第7章 函数', sessions: 5 },
        { id: 'c8', title: '第8章 指针', sessions: 4 }
      ]
    },
    {
      id: 'math',
      name: '高等数学A(1)',
      code: 'GBK0101001',
      teacher: '孙孟锋',
      place: 'BJ207',
      credit: 5,
      color: '#1f5fa8',
      slots: [
        { day: 1, period: '第3-4节', fromWeek: 1, toWeek: 16 },
        { day: 3, period: '第3-4节', fromWeek: 1, toWeek: 16 },
        { day: 5, period: '第3-4节', fromWeek: 1, toWeek: 16 }
      ],
      outline: [
        { id: 'm1', title: '第一章 函数与极限', sessions: 8 },
        { id: 'm2', title: '第二章 导数与微分', sessions: 8 },
        { id: 'm3', title: '第三章 微分中值定理与导数的应用', sessions: 8 },
        { id: 'm4', title: '第四章 不定积分', sessions: 8 },
        { id: 'm5', title: '第五章 定积分', sessions: 8 },
        { id: 'm6', title: '第六章 定积分的应用', sessions: 6 }
      ]
    },
    {
      id: 'chem-lab',
      name: '大学化学实验',
      code: 'GBK0104002',
      teacher: '理珍',
      place: 'HA四楼',
      credit: 1,
      color: '#b0722b',
      slots: [{ day: 1, period: '第5-6节', fromWeek: 1, toWeek: 16 }],
      outline: [
        { id: 'cl1', title: '实验1 仪器认领与基本操作', sessions: 2 },
        { id: 'cl2', title: '实验2 溶液的配制与标定', sessions: 2 },
        { id: 'cl3', title: '实验3 酸碱滴定', sessions: 2 },
        { id: 'cl4', title: '实验4 氧化还原滴定', sessions: 2 },
        { id: 'cl5', title: '实验5 分光光度法测铁', sessions: 2 },
        { id: 'cl6', title: '实验6 电离平衡与沉淀', sessions: 2 },
        { id: 'cl7', title: '实验7 综合设计实验', sessions: 2 },
        { id: 'cl8', title: '实验8 数据处理与实验报告', sessions: 2 }
      ]
    },
    {
      id: 'phys-tech',
      name: '物理学与技术进步',
      code: 'KBK0100H01',
      teacher: '尹鑫茂 等',
      place: 'D115',
      credit: 2,
      note: '第14周 蔡传兵 / 李拥华，第15周 孙硕 / 金腾宇（专题轮讲）',
      color: '#7b4fa0',
      slots: [
        { day: 1, period: '第7-8节', weeks: [9, 10, 11, 12, 13, 16] },
        { day: 4, period: '第9-10节', weeks: [9, 10, 11, 12, 13, 16] }
      ],
      outline: [
        { id: 'pt1', title: '专题一 物理学与技术创新', sessions: 2 },
        { id: 'pt2', title: '专题二 力学的现代应用', sessions: 2 },
        { id: 'pt3', title: '专题三 电磁学与信息时代', sessions: 2 },
        { id: 'pt4', title: '专题四 量子革命', sessions: 2 },
        { id: 'pt5', title: '专题五 相对论与宇宙', sessions: 2 },
        { id: 'pt6', title: '专题六 期末研讨与报告', sessions: 2 }
      ]
    },
    {
      id: 'pe',
      name: '体育(1)(保健班)',
      code: 'GBK2800007',
      teacher: '金海秀',
      place: 'A108',
      credit: 1,
      color: '#c0553f',
      slots: [{ day: 2, period: '第1-2节', fromWeek: 1, toWeek: 16 }],
      outline: [
        { id: 'pe1', title: '保健班导论与运动处方', sessions: 4 },
        { id: 'pe2', title: '太极拳/八段锦', sessions: 4 },
        { id: 'pe3', title: '体适能与体质测试', sessions: 4 },
        { id: 'pe4', title: '常见运动损伤预防', sessions: 4 }
      ]
    },
    {
      id: 'safety',
      name: '国家安全教育',
      code: 'GBK2000009',
      teacher: '张青子衿',
      place: 'FJ303',
      credit: 1,
      color: '#4a6b8a',
      slots: [{ day: 2, period: '第3-4节', fromWeek: 9, toWeek: 16 }],
      outline: [
        { id: 'sf1', title: '总体国家安全观', sessions: 2 },
        { id: 'sf2', title: '政治安全与国土安全', sessions: 2 },
        { id: 'sf3', title: '经济安全与科技安全', sessions: 2 },
        { id: 'sf4', title: '网络安全与生态安全', sessions: 2 }
      ]
    },
    {
      id: 'physics',
      name: '大学物理A(1)',
      code: 'GBK0103001',
      teacher: '高恒',
      place: 'DJ108',
      credit: 4,
      color: '#0f7b8a',
      slots: [
        { day: 2, period: '第5-6节', fromWeek: 1, toWeek: 16 },
        { day: 4, period: '第5-6节', fromWeek: 1, toWeek: 16 }
      ],
      outline: [
        { id: 'p1', title: '第1章 质点运动学', sessions: 3 },
        { id: 'p2', title: '第2章 牛顿定律与动量', sessions: 4 },
        { id: 'p3', title: '第3章 功与能', sessions: 3 },
        { id: 'p4', title: '第4章 刚体的转动', sessions: 5 },
        { id: 'p5', title: '第5章 静电场', sessions: 5 },
        { id: 'p6', title: '第6章 稳恒磁场', sessions: 5 },
        { id: 'p7', title: '第7章 电磁感应', sessions: 4 },
        { id: 'p8', title: '第8章 振动与波动', sessions: 3 }
      ]
    },
    {
      id: 'ethics',
      name: '思想道德与法治',
      code: 'GBK2000003',
      teacher: '王有英',
      place: 'FJ306',
      credit: 3,
      color: '#a33b6b',
      slots: [
        { day: 2, period: '第7-8节', fromWeek: 1, toWeek: 16 },
        { day: 4, period: '第7-8节', fromWeek: 1, toWeek: 16 }
      ],
      outline: [
        { id: 'e0', title: '绪论 担当复兴大任', sessions: 2 },
        { id: 'e1', title: '第一章 领悟人生真谛', sessions: 4 },
        { id: 'e2', title: '第二章 追求远大理想', sessions: 4 },
        { id: 'e3', title: '第三章 继承优良传统', sessions: 4 },
        { id: 'e4', title: '第四章 明确价值要求', sessions: 4 },
        { id: 'e5', title: '第五章 遵守道德规范', sessions: 6 },
        { id: 'e6', title: '第六章 学习法治思想', sessions: 4 },
        { id: 'e7', title: '第七章 培养法治思维', sessions: 4 }
      ]
    },
    {
      id: 'english',
      name: '大学英语C(1)',
      code: 'GBK0600009',
      teacher: '叶玮玮',
      place: 'DJ304',
      credit: 2,
      color: '#5f7a1f',
      slots: [{ day: 3, period: '第5-6节', fromWeek: 1, toWeek: 16 }],
      outline: [
        { id: 'en1', title: 'Unit 1 Campus Life', sessions: 2 },
        { id: 'en2', title: 'Unit 2 Learning Styles', sessions: 2 },
        { id: 'en3', title: 'Unit 3 Culture Exchange', sessions: 2 },
        { id: 'en4', title: 'Unit 4 Technology', sessions: 2 },
        { id: 'en5', title: 'Unit 5 Environment', sessions: 2 },
        { id: 'en6', title: 'Unit 6 Career', sessions: 2 },
        { id: 'en7', title: 'Unit 7 四级专项', sessions: 2 },
        { id: 'en8', title: 'Unit 8 期末复习', sessions: 2 }
      ]
    },
    {
      id: 'phys-lab',
      name: '大学物理实验A(1)',
      code: 'GBK0103003',
      teacher: '周黎红',
      place: 'F楼实验中心',
      credit: 1,
      color: '#6b6b6b',
      slots: [{ day: 3, period: '第7-8节', fromWeek: 1, toWeek: 16 }],
      outline: [
        { id: 'pl1', title: '实验1 力学基本测量', sessions: 2 },
        { id: 'pl2', title: '实验2 刚体转动惯量', sessions: 2 },
        { id: 'pl3', title: '实验3 示波器与电学测量', sessions: 2 },
        { id: 'pl4', title: '实验4 静电场的描绘', sessions: 2 },
        { id: 'pl5', title: '实验5 磁场的测量', sessions: 2 },
        { id: 'pl6', title: '实验6 光的干涉与衍射', sessions: 2 },
        { id: 'pl7', title: '实验7 综合设计实验', sessions: 2 },
        { id: 'pl8', title: '实验8 误差分析与报告', sessions: 2 }
      ]
    },
    {
      id: 'chem',
      name: '大学化学',
      code: 'GBK0104001',
      teacher: '理珍',
      place: 'BJ207',
      credit: 2,
      color: '#8a5a2b',
      slots: [{ day: 4, period: '第1-2节', fromWeek: 1, toWeek: 16 }],
      outline: [
        { id: 'ch1', title: '第1章 绪论与化学计量', sessions: 2 },
        { id: 'ch2', title: '第2章 原子结构与元素周期律', sessions: 3 },
        { id: 'ch3', title: '第3章 化学键与分子结构', sessions: 3 },
        { id: 'ch4', title: '第4章 化学热力学基础', sessions: 4 },
        { id: 'ch5', title: '第5章 化学平衡与溶液', sessions: 4 }
      ]
    },
    {
      id: 'crime',
      name: '犯罪与预防',
      code: 'ZBK1000008',
      teacher: '王林林',
      place: 'CJ304',
      credit: 1,
      color: '#8c2f2f',
      slots: [{ day: 5, period: '第1-2节', fromWeek: 1, toWeek: 8 }],
      outline: [
        { id: 'cr1', title: '第一讲 犯罪现象概览', sessions: 2 },
        { id: 'cr2', title: '第二讲 犯罪成因分析', sessions: 2 },
        { id: 'cr3', title: '第三讲 常见犯罪类型与防范', sessions: 2 },
        { id: 'cr4', title: '第四讲 风险识别与自我保护', sessions: 2 }
      ]
    },
    {
      id: 'policy',
      name: '形势与政策',
      code: 'GBK2000001',
      teacher: '张富文',
      place: 'EJ103',
      credit: 0,
      color: '#3f4a5a',
      slots: [{ day: 4, period: '第11-12节', weeks: [4, 8, 12, 16] }],
      outline: [
        { id: 'po1', title: '专题一 当前国际形势', sessions: 1 },
        { id: 'po2', title: '专题二 国家发展大局', sessions: 1 },
        { id: 'po3', title: '专题三 社会热点解读', sessions: 1 },
        { id: 'po4', title: '专题四 期末总结', sessions: 1 }
      ]
    }
  ];

  function defaultState() {
    return JSON.parse(
      JSON.stringify({
        version: 1,
        termStart: TERM_START,
        termStartGuessed: true,
        homework: [],
        done: {},
        courses: COURSES
      })
    );
  }

  return {
    TERM_START: TERM_START,
    META: META,
    courses: COURSES,
    defaultState: defaultState
  };
});
