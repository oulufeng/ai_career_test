require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

// 中间件
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 限流配置
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100 // 每个 IP 最多 100 个请求
});
app.use('/api/', limiter);

// 初始化数据库
const dbPath = path.join(__dirname, 'career_test.db');
const db = new Database(dbPath);

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    session_id TEXT,
    answers TEXT NOT NULL,
    dimension_scores TEXT,
    ai_analysis TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    api_calls INTEGER DEFAULT 0,
    last_reset DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ==================== 工具函数 ====================
function generateSessionId() {
  return 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (error) {
    return res.status(401).json({ error: '无效的认证令牌' });
  }
}

// ==================== AI 分析服务 ====================
async function callDeepSeekAPI(answersData, dimensionScores) {
  const prompt = `你是一位专业的职业咨询师。请根据以下 20 道职业测试题的用户答案，生成一份详细的职业分析报告。

用户答案数据：
${JSON.stringify(answersData, null, 2)}

维度得分：
${JSON.stringify(dimensionScores, null, 2)}

请严格按照以下 JSON 格式返回分析结果（不要使用 Markdown 代码块，直接返回纯 JSON）：
{
  "personality": {
    "description": "对用户性格特点的详细分析，包括优势、特点、潜在盲点，300 字以内",
    "dimensions": {
      "外向性": 0-100,
      "独立性": 0-100,
      "分析能力": 0-100,
      "创新性": 0-100,
      "领导力": 0-100,
      "细致度": 0-100,
      "抗压能力": 0-100,
      "社交需求": 0-100
    }
  },
  "jobs": [
    {
      "name": "岗位名称",
      "matchRate": 85,
      "reason": "推荐理由，50 字以内",
      "hardSkills": ["技能 1", "技能 2", "技能 3"],
      "softSkills": ["技能 1", "技能 2", "技能 3"]
    }
  ],
  "learningPlan": {
    "targetJob": "目标岗位名称",
    "steps": [
      {
        "title": "阶段标题",
        "description": "具体学习内容和建议，100 字以内"
      }
    ]
  }
}

注意：
1. 推荐 3-5 个岗位，匹配度从高到低排序
2. 学习方案针对匹配度最高的岗位
3. 返回纯 JSON，不要有 Markdown 格式`;

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是一位专业的职业咨询师，擅长根据用户特点提供职业规划建议。请严格返回纯 JSON 格式，不要使用 Markdown 代码块。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2500
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        timeout: 30000
      }
    );

    let content = response.data.choices[0].message.content;

    // 清理可能的 Markdown 标记
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    // 提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('无法解析 AI 返回结果');
  } catch (error) {
    console.error('DeepSeek API 调用失败:', error.message);
    throw new Error(`AI 服务调用失败：${error.message}`);
  }
}

// 离线分析（降级方案）
function generateOfflineAnalysis(dimensionScores) {
  const jobProfiles = {
    '软件工程师': { keywords: ['analytical', 'independent', 'detail', 'theoretical'], skills: ['编程语言', '数据结构', '系统设计', 'Git'] },
    '数据分析师': { keywords: ['analytical', 'detail', 'independent', 'concrete'], skills: ['统计学', 'SQL', 'Python', '数据可视化'] },
    '产品经理': { keywords: ['bigpicture', 'social', 'leadership', 'adaptive'], skills: ['需求分析', '产品设计', '项目管理', '数据分析'] },
    'UI/UX 设计师': { keywords: ['innovative', 'detail', 'abstract'], skills: ['Figma', '用户研究', '交互设计', '视觉设计'] },
    '市场专员': { keywords: ['social', 'expressive', 'adaptive', 'risktaking'], skills: ['市场调研', '营销策划', '内容创作', '数据分析'] },
    '人力资源': { keywords: ['social', 'team', 'responsible'], skills: ['招聘流程', '员工关系', '绩效管理', '劳动法规'] },
    '算法工程师': { keywords: ['analytical', 'theoretical', 'abstract', 'detail'], skills: ['机器学习', '深度学习', '编程', '数学'] },
    '内容运营': { keywords: ['expressive', 'innovative', 'detail'], skills: ['内容策划', '文案写作', '新媒体', '数据分析'] }
  };

  const dim = dimensionScores;
  const jobScores = {};

  Object.entries(jobProfiles).forEach(([job, profile]) => {
    let score = 50;
    profile.keywords.forEach(keyword => {
      score += (dim[keyword] || 0) * 3;
    });
    jobScores[job] = Math.min(95, Math.max(60, score));
  });

  const sortedJobs = Object.entries(jobScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const topJob = sortedJobs[0][0];

  return {
    personality: {
      description: `你的性格特点：${dim.analytical > 0 ? '逻辑分析能力强' : '直觉敏锐'}，${dim.independent > 0 ? '独立自主' : '善于协作'}，${dim.innovative > 0 ? '富有创意' : '稳重踏实'}。建议继续发挥优势，同时注意全面发展。`,
      dimensions: {
        '外向性': Math.max(0, Math.min(100, 50 + (dim.social || 0) * 10)),
        '独立性': Math.max(0, Math.min(100, 50 + (dim.independent || 0) * 10)),
        '分析能力': Math.max(0, Math.min(100, 50 + (dim.analytical || 0) * 10)),
        '创新性': Math.max(0, Math.min(100, 50 + (dim.innovative || 0) * 10)),
        '领导力': Math.max(0, Math.min(100, 50 + (dim.leadership || 0) * 10)),
        '细致度': Math.max(0, Math.min(100, 50 + (dim.detail || 0) * 10)),
        '抗压能力': Math.max(0, Math.min(100, 50 + (dim.resilience || 0) * 10)),
        '社交需求': Math.max(0, Math.min(100, 50 + (dim.socialneed || 0) * 10))
      }
    },
    jobs: sortedJobs.map(([job, score]) => ({
      name: job,
      matchRate: Math.round(score),
      reason: `基于你的特点匹配`,
      hardSkills: jobProfiles[job].skills,
      softSkills: ['沟通协作', '学习能力', '问题解决', '时间管理']
    })),
    learningPlan: {
      targetJob: topJob,
      steps: [
        { title: '基础入门（1-2 月）', description: '系统学习岗位基础知识和核心概念' },
        { title: '技能提升（2-3 月）', description: '掌握必备工具和技能，通过练习巩固' },
        { title: '项目实战（2-3 月）', description: '参与实际项目，积累实战经验' },
        { title: '持续精进（持续）', description: '关注行业动态，保持竞争力' }
      ]
    }
  };
}

// ==================== API 路由 ====================

// 用户注册
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const stmt = db.prepare('INSERT INTO users (username, password, email) VALUES (?, ?, ?)');
    const result = stmt.run(username, hashedPassword, email || null);

    const token = jwt.sign({ userId: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, username, message: '注册成功' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') {
      return res.status(400).json({ error: '用户名已存在' });
    }
    res.status(500).json({ error: '注册失败：' + error.message });
  }
});

// 用户登录
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    // 初始化 API 使用记录
    const apiUsage = db.prepare('SELECT * FROM api_usage WHERE user_id = ?').get(user.id);
    if (!apiUsage) {
      db.prepare('INSERT INTO api_usage (user_id) VALUES (?)').run(user.id);
    }

    res.json({ token, username, message: '登录成功' });
  } catch (error) {
    res.status(500).json({ error: '登录失败：' + error.message });
  }
});

// 获取当前用户信息
app.get('/api/auth/me', verifyToken, (req, res) => {
  const user = db.prepare('SELECT id, username, email, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json(user);
});

// 提交测试并获取 AI 分析
app.post('/api/test/analyze', verifyToken, async (req, res) => {
  try {
    const { answers, dimensionScores, sessionId } = req.body;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: '答案数据无效' });
    }

    const session = sessionId || generateSessionId();
    const answersData = questions.map((q, idx) => ({
      question: q.text,
      answer: answers[idx] !== undefined ? q.options[answers[idx]]?.text : '',
      dimension: q.dimension
    }));

    let analysis;
    let useAI = false;

    // 检查是否使用 AI 分析
    if (DEEPSEEK_API_KEY) {
      try {
        // 检查 API 使用限制
        const apiUsage = db.prepare('SELECT * FROM api_usage WHERE user_id = ?').get(req.userId);
        const canUseAI = !apiUsage || apiUsage.api_calls < 10; // 每天 10 次限制

        if (canUseAI) {
          analysis = await callDeepSeekAPI(answersData, dimensionScores);
          useAI = true;

          // 更新 API 使用计数
          db.prepare(`
            UPDATE api_usage
            SET api_calls = api_calls + 1,
                last_reset = CASE
                  WHEN date(last_reset) < date('now') THEN datetime('now')
                  ELSE last_reset
                END
            WHERE user_id = ?
          `).run(req.userId);
        }
      } catch (aiError) {
        console.error('AI 分析失败，使用离线分析:', aiError.message);
        analysis = generateOfflineAnalysis(dimensionScores);
      }
    } else {
      analysis = generateOfflineAnalysis(dimensionScores);
    }

    // 保存测试结果
    const stmt = db.prepare(`
      INSERT INTO test_results (user_id, session_id, answers, dimension_scores, ai_analysis)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      req.userId,
      session,
      JSON.stringify(answers),
      JSON.stringify(dimensionScores),
      JSON.stringify(analysis)
    );

    res.json({
      sessionId: session,
      analysis,
      useAI
    });
  } catch (error) {
    console.error('测试分析失败:', error);
    res.status(500).json({ error: '分析失败：' + error.message });
  }
});

// 获取历史测试记录
app.get('/api/test/history', verifyToken, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const results = db.prepare(`
      SELECT id, session_id, created_at, ai_analysis,
             json_extract(ai_analysis, '$.learningPlan.targetJob') as target_job,
             json_extract(ai_analysis, '$.jobs[0].matchRate') as top_match
      FROM test_results
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(req.userId, limit);

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: '获取历史记录失败：' + error.message });
  }
});

// 获取单次测试详情
app.get('/api/test/:sessionId', verifyToken, (req, res) => {
  try {
    const result = db.prepare(`
      SELECT * FROM test_results
      WHERE session_id = ? AND user_id = ?
    `).get(req.params.sessionId, req.userId);

    if (!result) {
      return res.status(404).json({ error: '测试记录不存在' });
    }

    res.json({
      ...result,
      answers: JSON.parse(result.answers),
      dimension_scores: JSON.parse(result.dimension_scores),
      ai_analysis: JSON.parse(result.ai_analysis)
    });
  } catch (error) {
    res.status(500).json({ error: '获取测试详情失败：' + error.message });
  }
});

// 获取系统状态
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    aiEnabled: !!DEEPSEEK_API_KEY,
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 游客提交测试（无需登录）
app.post('/api/test/guest', async (req, res) => {
  try {
    const { answers, dimensionScores } = req.body;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: '答案数据无效' });
    }

    const sessionId = generateSessionId();
    const answersData = questions.map((q, idx) => ({
      question: q.text,
      answer: answers[idx] !== undefined ? q.options[answers[idx]]?.text : '',
      dimension: q.dimension
    }));

    let analysis;
    let useAI = false;

    if (DEEPSEEK_API_KEY) {
      try {
        analysis = await callDeepSeekAPI(answersData, dimensionScores);
        useAI = true;
      } catch (aiError) {
        analysis = generateOfflineAnalysis(dimensionScores);
      }
    } else {
      analysis = generateOfflineAnalysis(dimensionScores);
    }

    res.json({
      sessionId,
      analysis,
      useAI
    });
  } catch (error) {
    res.status(500).json({ error: '分析失败：' + error.message });
  }
});

// 题目数据（与前端共享）
const questions = [
  { id: 1, dimension: '性格特质', text: '在社交场合中，你通常感觉如何？', options: [
    { text: '充满活力，喜欢和很多人交流', score: { social: 2, introvert: -1 } },
    { text: '比较自在，但更偏好小群体交流', score: { social: 1, introvert: 0 } },
    { text: '有些紧张，更喜欢熟悉的人', score: { social: -1, introvert: 1 } },
    { text: '感到疲惫，希望早点离开', score: { social: -2, introvert: 2 } }
  ]},
  { id: 2, dimension: '工作偏好', text: '你更喜欢哪种工作方式？', options: [
    { text: '独立完成，自己掌控节奏', score: { independent: 2, team: -1 } },
    { text: 'mostly 独立，偶尔协作', score: { independent: 1, team: 0 } },
    { text: 'mostly 协作，偶尔独立', score: { independent: -1, team: 1 } },
    { text: '团队合作，大家一起讨论', score: { independent: -2, team: 2 } }
  ]},
  { id: 3, dimension: '沟通风格', text: '在表达想法时，你倾向于？', options: [
    { text: '直接表达，清晰阐述观点', score: { expressive: 2, listener: -1 } },
    { text: '适度表达，也愿意听别人说', score: { expressive: 1, listener: 1 } },
    { text: '先听别人说，再补充想法', score: { expressive: -1, listener: 2 } },
    { text: '尽量不表达，避免冲突', score: { expressive: -2, listener: 1 } }
  ]},
  { id: 4, dimension: '决策方式', text: '做决定时，你通常依靠？', options: [
    { text: '直觉和第一感觉', score: { intuitive: 2, analytical: -1 } },
    { text: '感觉为主，参考一些数据', score: { intuitive: 1, analytical: 0 } },
    { text: '数据为主，参考一些感觉', score: { intuitive: -1, analytical: 1 } },
    { text: '详细分析所有数据和信息', score: { intuitive: -2, analytical: 2 } }
  ]},
  { id: 5, dimension: '学习倾向', text: '学习新知识时，你更喜欢？', options: [
    { text: '先理解理论框架', score: { theoretical: 2, practical: -1 } },
    { text: '理论学习为主，实践为辅', score: { theoretical: 1, practical: 0 } },
    { text: '实践操作为主，理论为辅', score: { theoretical: -1, practical: 1 } },
    { text: '直接动手实践，边做边学', score: { theoretical: -2, practical: 2 } }
  ]},
  { id: 6, dimension: '压力应对', text: '面对压力时，你的反应是？', options: [
    { text: '积极应对，视为挑战', score: { resilience: 2, avoidance: -2 } },
    { text: '有些紧张，但会尝试解决', score: { resilience: 1, avoidance: -1 } },
    { text: '感到焦虑，希望有人帮助', score: { resilience: -1, avoidance: 1 } },
    { text: '想要逃避，拖延处理', score: { resilience: -2, avoidance: 2 } }
  ]},
  { id: 7, dimension: '创新倾向', text: '对于新事物和新方法，你？', options: [
    { text: '非常感兴趣，主动尝试', score: { innovative: 2, conservative: -2 } },
    { text: '愿意尝试，但会评估风险', score: { innovative: 1, conservative: -1 } },
    { text: '比较谨慎，更相信成熟方法', score: { innovative: -1, conservative: 1 } },
    { text: 'prefer 传统方式，不爱改变', score: { innovative: -2, conservative: 2 } }
  ]},
  { id: 8, dimension: '领导意愿', text: '在团队中，你通常扮演什么角色？', options: [
    { text: '主动领导，分配任务', score: { leadership: 2, follower: -2 } },
    { text: '偶尔领导，看情况而定', score: { leadership: 1, follower: -1 } },
    { text: 'mostly 配合，完成分配的任务', score: { leadership: -1, follower: 1 } },
    { text: 'prefer 被领导，不承担管理', score: { leadership: -2, follower: 2 } }
  ]},
  { id: 9, dimension: '细节关注', text: '处理任务时，你更关注？', options: [
    { text: '整体方向和结果', score: { bigpicture: 2, detail: -2 } },
    { text: 'mostly 大局，适当关注细节', score: { bigpicture: 1, detail: -1 } },
    { text: 'mostly 细节，也看整体', score: { bigpicture: -1, detail: 1 } },
    { text: '每个细节都要完美', score: { bigpicture: -2, detail: 2 } }
  ]},
  { id: 10, dimension: '时间管理', text: '你如何安排时间和任务？', options: [
    { text: '详细计划，严格执行', score: { planned: 2, flexible: -2 } },
    { text: '有大致计划，适度调整', score: { planned: 1, flexible: -1 } },
    { text: '灵活安排，随情况调整', score: { planned: -1, flexible: 1 } },
    { text: '随性而为，不喜欢被约束', score: { planned: -2, flexible: 2 } }
  ]},
  { id: 11, dimension: '成就动机', text: '什么最能激励你努力工作？', options: [
    { text: '个人成长和内在满足', score: { intrinsic: 2, extrinsic: -1 } },
    { text: '内在满足为主，外在奖励为辅', score: { intrinsic: 1, extrinsic: 0 } },
    { text: '外在奖励为主，内在满足为辅', score: { intrinsic: -1, extrinsic: 1 } },
    { text: '薪酬、地位、认可等外在回报', score: { intrinsic: -2, extrinsic: 2 } }
  ]},
  { id: 12, dimension: '风险偏好', text: '面对不确定的机会，你会？', options: [
    { text: '果断抓住，高风险高回报', score: { risktaking: 2, riskaverse: -2 } },
    { text: '评估后愿意尝试', score: { risktaking: 1, riskaverse: -1 } },
    { text: '谨慎考虑，偏好稳妥', score: { risktaking: -1, riskaverse: 1 } },
    { text: 'avoid 风险，选择确定选项', score: { risktaking: -2, riskaverse: 2 } }
  ]},
  { id: 13, dimension: '社交需求', text: '工作中，你希望的社交程度是？', options: [
    { text: '大量社交，经常与人互动', score: { socialneed: 2, loner: -2 } },
    { text: '适度社交，有独处时间', score: { socialneed: 1, loner: -1 } },
    { text: '较少社交，mostly 专注工作', score: { socialneed: -1, loner: 1 } },
    { text: 'minimal 社交，独立工作', score: { socialneed: -2, loner: 2 } }
  ]},
  { id: 14, dimension: '工作节奏', text: '你 prefer 的工作节奏是？', options: [
    { text: '快速节奏，多任务并行', score: { fastpace: 2, slowpace: -2 } },
    { text: '较快节奏，有一定挑战', score: { fastpace: 1, slowpace: -1 } },
    { text: '稳定节奏，不慌不忙', score: { fastpace: -1, slowpace: 1 } },
    { text: '缓慢节奏，深入细致', score: { fastpace: -2, slowpace: 2 } }
  ]},
  { id: 15, dimension: '问题类型', text: '你更擅长处理哪种问题？', options: [
    { text: '抽象概念和理论问题', score: { abstract: 2, concrete: -2 } },
    { text: '抽象为主，具体为辅', score: { abstract: 1, concrete: -1 } },
    { text: '具体问题，实际操作', score: { abstract: -1, concrete: 1 } },
    { text: '具体实际问题，有明确答案', score: { abstract: -2, concrete: 2 } }
  ]},
  { id: 16, dimension: '反馈需求', text: '你多久需要一次工作反馈？', options: [
    { text: '经常需要，及时了解表现', score: { feedback: 2, independent: -1 } },
    { text: '定期反馈即可', score: { feedback: 1, independent: 0 } },
    { text: '偶尔反馈，mostly 靠自己', score: { feedback: -1, independent: 1 } },
    { text: '很少需要，我相信自己判断', score: { feedback: -2, independent: 2 } }
  ]},
  { id: 17, dimension: '变化适应', text: '面对工作变化，你的感受是？', options: [
    { text: '兴奋期待，欢迎变化', score: { adaptive: 2, stable: -2 } },
    { text: '可以接受，需要时间调整', score: { adaptive: 1, stable: -1 } },
    { text: '有些不适，prefer 稳定', score: { adaptive: -1, stable: 1 } },
    { text: '强烈 prefer 稳定，厌恶变化', score: { adaptive: -2, stable: 2 } }
  ]},
  { id: 18, dimension: '责任态度', text: '面对重要责任，你通常？', options: [
    { text: '主动承担，全力以赴', score: { responsible: 2, avoidant: -2 } },
    { text: '愿意承担，尽力完成', score: { responsible: 1, avoidant: -1 } },
    { text: '谨慎承担，评估能力', score: { responsible: -1, avoidant: 1 } },
    { text: '尽量避免，压力太大', score: { responsible: -2, avoidant: 2 } }
  ]},
  { id: 19, dimension: '价值导向', text: '选择工作时，你最看重？', options: [
    { text: '工作意义和社会价值', score: { meaning: 2, material: -1 } },
    { text: '意义为主，薪酬为辅', score: { meaning: 1, material: 0 } },
    { text: '薪酬为主，意义为辅', score: { meaning: -1, material: 1 } },
    { text: '薪酬福利和发展前景', score: { meaning: -2, material: 2 } }
  ]},
  { id: 20, dimension: '职业目标', text: '你的长期职业目标是？', options: [
    { text: '成为领域专家/技术大牛', score: { specialist: 2, manager: -2 } },
    { text: 'mostly 专业发展，适度管理', score: { specialist: 1, manager: -1 } },
    { text: 'mostly 管理发展，保持专业', score: { specialist: -1, manager: 1 } },
    { text: '成为管理者/领导者', score: { specialist: -2, manager: 2 } }
  ]}
];

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         职业功能测试系统 - 服务器已启动                    ║
╠═══════════════════════════════════════════════════════════╣
║  访问地址：http://localhost:${PORT}                         ║
║  API 文档：http://localhost:${PORT}/api/status              ║
║  AI 分析：${DEEPSEEK_API_KEY ? '✅ 已启用' : '❌ 未配置'}                      ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
