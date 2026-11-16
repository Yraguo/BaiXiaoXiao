/**
 * 考试查询本地探测（本机网络，不经过云函数）
 *
 * 用途：区分「云函数出口 IP 被学校前置防护拦掉」和「请求构造不对」。
 *   本地能查出来 → 是云函数出口的问题；
 *   本地也失败   → 是请求构造的问题，看下面的步骤详情继续调。
 *
 * 只在本机运行，不上传任何东西，不写日志文件。
 * 密码输入时不回显，也不会出现在输出里。
 */

const readline = require('node:readline');

const fn = require('../cloudfunctions/jwimport');

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\n已取消\n');
          process.exit(0);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        value += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function printSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) {
    console.log('  （没有步骤信息）');
    return;
  }
  steps.forEach((item, i) => {
    const name = (item && item.step) || 'step';
    let detail = (item && (item.detail || item.error)) || '';

    // 登录那一步存的是散字段，拼成人能读的一行
    if (name === '3-login-post') {
      detail = 'HTTP ' + item.status + ' ' + item.bytes + 'B' +
        (item.location ? ' 跳往 ' + item.location : ' 未跳转') +
        ' Cookie[' + ((item.cookies || []).join(',')) + ']';
    }
    console.log('  ' + String(i + 1).padStart(2) + '. ' + name.padEnd(14) + ' ' + detail);
  });
}

(async () => {
  console.log('=== 考试查询本地探测 ===');
  console.log('本脚本在你的电脑上直连学校教务，不经过云函数，不上传任何数据。\n');

  const username = await ask('学号：');
  const password = await askHidden('密码（输入时不显示）：');

  if (!username || !password) {
    console.log('\n学号或密码为空，已退出。');
    process.exit(1);
  }

  console.log('\n正在登录并查询，大约 5–15 秒…\n');

  let result;
  const startedAt = Date.now();
  try {
    // semester 1 → xqm 3（秋季学期），与教务网页里抓到的一致
    result = await fn.main({ action: 'exam', username, password, xnm: '2026', semester: 1 });
  } catch (error) {
    console.log('调用异常：' + ((error && error.message) || error));
    process.exit(1);
  }

  const elapsed = Date.now() - startedAt;

  console.log('耗时 ' + elapsed + 'ms');
  console.log('结果 ok=' + (result && result.ok));

  if (result && result.ok) {
    const list = result.exams || result.courses || [];
    console.log('\n【成功】查到 ' + list.length + ' 场考试：\n');
    list.slice(0, 8).forEach((item, i) => {
      console.log('  ' + (i + 1) + '. ' + (item.name || '未命名'));
      console.log('     ' + [item.type, item.time, item.room, item.seat && ('座位 ' + item.seat), item.campus]
        .filter(Boolean).join(' · '));
    });
    if (list.length > 8) console.log('  …还有 ' + (list.length - 8) + ' 场');
    console.log('\n步骤详情（这份输出用来和云端失败的诊断做对比）：');
    printSteps(result.steps);
    console.log('\n结论：本地能查到 → 云函数那边的 901 是出口 IP 被拦，不是参数问题。');
  } else {
    console.log('错误：' + ((result && result.error) || '未知'));
    console.log('类型：' + ((result && result.kind) || '-'));
    console.log('\n步骤详情：');
    printSteps(result && result.steps);

    const attempts = (result && result.attempts) || [];
    if (attempts.length) {
      console.log('\n接口尝试：');
      attempts.forEach((item, i) => {
        console.log('  ' + (i + 1) + '. ' + (item.label || item.path) +
          '  HTTP ' + (item.status || '-') +
          '  ' + (item.bytes !== undefined ? item.bytes + 'B' : '') +
          (item.error ? '  错误 ' + item.error : '') +
          (item.head ? '\n     开头 ' + item.head : ''));
      });
    }

    console.log('\n结论：本地也失败 → 是请求构造的问题，把上面整段复制给开发者。');
  }

  console.log('\n（本窗口可以直接关掉）');
})();
