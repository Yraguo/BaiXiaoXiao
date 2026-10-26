/**
 * 教务导入协议层 · 离线单测（不需要登录真实教务系统）
 *
 * 覆盖三件最容易出错、且错了只表现为"登录失败"的事：
 *   1. 地址解析：各种粘贴形态 → baseUrl + loginUrl
 *   2. 登录页要素提取：csrftoken / mmsfjm / RSA 公钥 / 验证码
 *   3. RSA 加密：真实密钥加密 → Node 私钥解密 → 比字节
 *
 * 用法（cwd 必须是 baixiaoxiao-mp）：node scripts/unit-jw.mjs
 */
import { buildSync } from 'esbuild';
import crypto from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';

mkdirSync('.tmp', { recursive: true });

/** 小程序全局在 node 里不存在；给个空壳，避免模块顶层就炸 */
globalThis.uni = { request: () => {}, getStorageSync: () => '', setStorageSync: () => {} };

const bundle = (entry, out) =>
  buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile: out,
    format: 'esm',
    platform: 'neutral',
    external: ['vue', '@dcloudio/*']
  });

bundle('src/services/jw/address.ts', '.tmp/jw-address.mjs');
bundle('src/services/jw/zf.ts', '.tmp/jw-zf.mjs');
bundle('src/shared/zfClient.ts', '.tmp/jw-zfclient.mjs');

const { parseJwAddress, loginUrlFor } = await import('../.tmp/jw-address.mjs');
const { parseLoginPage, currentXnm, describeImportError, jwRootOf } = await import('../.tmp/jw-zf.mjs');
const { parseKbList, encryptPassword } = await import('../.tmp/jw-zfclient.mjs');

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log('PASS  ' + name + (extra ? '  — ' + extra : ''));
  } else {
    fail++;
    console.log('FAIL  ' + name + (extra ? '  — ' + extra : ''));
  }
}

/* ============ 1. 地址解析 ============ */
{
  const a = parseJwAddress('https://jwglxt.buct.edu.cn');
  ok('裸域名 → baseUrl 就是裸域名', a.ok && a.parts.baseUrl === 'https://jwglxt.buct.edu.cn', a.parts.baseUrl);
  ok('裸域名 → 教务根路径补出 /jwglxt', jwRootOf(a.parts.baseUrl) === 'https://jwglxt.buct.edu.cn/jwglxt', jwRootOf(a.parts.baseUrl));
  ok(
    '登录页地址正确',
    a.parts.loginUrl === 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/login_slogin.html',
    a.parts.loginUrl
  );

  const b = parseJwAddress('https://jw.example.edu.cn:30443/jwglxt/xtgl/login_slogin.html');
  ok('完整登录页 → 截到教务目录并保留端口', b.ok && b.parts.baseUrl === 'https://jw.example.edu.cn:30443/jwglxt', b.parts.baseUrl);

  const c = parseJwAddress('jw.example.edu.cn/jwglxt');
  ok('无协议 → 默认补 https', c.ok && c.parts.baseUrl === 'https://jw.example.edu.cn/jwglxt', c.parts.baseUrl);

  ok('非 http(s) 被拒', !parseJwAddress('ftp://x.edu.cn').ok);
  ok('非网址被拒', !parseJwAddress('随便一段文字').ok);
  ok('空输入被拒', !parseJwAddress('').ok);
  ok('带空格被拒', !parseJwAddress('https://a b.com').ok);

  const g = parseJwAddress('https://jw.buct.edu.cn:8080');
  ok('保留端口', g.ok && g.parts.domain === 'jw.buct.edu.cn:8080', g.parts.domain);

  ok(
    'loginUrlFor 不重复拼 jwglxt',
    loginUrlFor('https://x.edu.cn/jwglxt') === 'https://x.edu.cn/jwglxt/xtgl/login_slogin.html',
    loginUrlFor('https://x.edu.cn/jwglxt')
  );
}

/* ============ 2. 登录页解析 ============ */
{
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const jwk = publicKey.export({ format: 'jwk' });
  const modB64 = Buffer.from(jwk.n, 'base64url').toString('base64');
  const expB64 = Buffer.from(jwk.e, 'base64url').toString('base64');

  const html = `<!DOCTYPE html><html><body>
    <form id="login" method="post" action="/jwglxt/xtgl/login_slogin.html">
      <input type="hidden" id="csrftoken" name="csrftoken" value="tok-abc-123">
      <input type="hidden" id="mmsfjm" name="mmsfjm" value="1">
      <input id="yhm" name="yhm" type="text">
      <input id="mm" name="mm" type="password">
      <input id="yzm" name="yzm" type="text">
      <img id="kaptchaImg" src="/jwglxt/kaptcha?time=1699999">
    </form>
    <script type="text/javascript">
      var modulus = "${modB64}";
      var exponent = "${expB64}";
    </script>
  </body></html>`;

  const pageUrl = 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/login_slogin.html';
  const info = parseLoginPage(html, pageUrl);
  ok('取到 csrftoken', info.csrfToken === 'tok-abc-123', info.csrfToken);
  ok('判定需要 RSA 加密', info.needEncrypt === true);
  ok('取到 modulus', info.modulus === modB64, info.modulus.slice(0, 10) + '…');
  ok('取到 exponent', info.exponent === expB64, info.exponent);
  ok('识别出验证码字段', info.hasCaptcha === true);
  ok(
    '验证码图拼成绝对地址',
    info.captchaUrl === 'https://jwglxt.buct.edu.cn/jwglxt/kaptcha?time=1699999',
    info.captchaUrl
  );

  ok(
    'mmsfjm=0 → 明文模式',
    parseLoginPage(html.replace('name="mmsfjm" value="1"', 'name="mmsfjm" value="0"'), pageUrl).needEncrypt === false
  );

  let threw = '';
  try {
    parseLoginPage(html.replace(/\s*<input type="hidden" id="mmsfjm"[^>]*>/, ''), pageUrl);
  } catch (e) {
    threw = e.kind || e.message;
  }
  ok('缺 mmsfjm → PAGE_CHANGED（绝不猜明文）', threw === 'PAGE_CHANGED', threw);

  const i2 = parseLoginPage(`<input type="hidden" name="mmsfjm" value="1"><script>var k=new RSAKey();k.setPublic("${modB64}","AQAB");</script>`, 'https://x/');
  ok('setPublic() 写法也能取到公钥', i2.modulus === modB64);

  ok('无 yzm → hasCaptcha=false', parseLoginPage('<form><input type="hidden" name="mmsfjm" value="0"><input name="yhm"></form>', 'https://x/').hasCaptcha === false);
}

/* ============ 3. RSA 加密往返 ============ */
{
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const jwk = publicKey.export({ format: 'jwk' });
  const modB64 = Buffer.from(jwk.n, 'base64url').toString('base64');
  const expB64 = Buffer.from(jwk.e, 'base64url').toString('base64');

  const pwd = 'Buct#2026密码';
  const cipher = encryptPassword(pwd, modB64, expB64);
  const plain = crypto
    .privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(cipher, 'base64'))
    .toString('utf8');
  ok('RSA 往返一致（含中文）', plain === pwd, plain);
  ok('密文长度 = 模长', Buffer.from(cipher, 'base64').length === 128);
}

/* ============ 4. 学年推算 ============ */
ok('9 月算新学年', currentXnm(new Date('2026-09-01')) === '2026');
ok('8 月仍属上一学年', currentXnm(new Date('2026-08-31')) === '2025');
ok('3 月属上一学年', currentXnm(new Date('2027-03-15')) === '2026');

/* ============ 5. 课表 JSON 解析（用原工程 fixture） ============ */
{
  const raw = readFileSync(
    'E:/Gary/北京化工大学/北化app/BaiXiaoXiao/BaiXiaoXiao/fixtures/zf-kblist.sample.json',
    'utf8'
  );
  const rows = parseKbList(raw);
  ok('裸数组形态的 kbList 也能解析', rows.length > 0, rows.length + ' 条');
  ok('第一条是高等数学', rows[0]?.name === '高等数学A(一)', rows[0]?.name);
  ok('周次展开正确', rows[0]?.weeks.length === 16, String(rows[0]?.weeks.length));
  ok('多段节次被拆开', rows.some((r) => r.startPeriod === 9 && r.endPeriod === 10), '6-7,9-10 → 两段');

  const wrapped = JSON.stringify({ kbList: JSON.parse(raw) });
  ok('{kbList:[…]} 形态也解析', parseKbList(wrapped).length === rows.length);
}

/* ============ 6. 错误话术 ============ */
{
  const msg = describeImportError({ ok: false, errorKind: 'CORS_OR_NETWORK', error: 'request:fail' });
  ok('网络错误会提示配白名单', msg.includes('request 合法域名'));
  const msg2 = describeImportError({ ok: false, errorKind: 'INVALID_CREDENTIALS', error: '学号或密码不正确，请重新输入。' });
  ok('凭据错误不掺网络话术', !msg2.includes('合法域名'));
}

console.log(`\n合计 ${pass + fail} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
