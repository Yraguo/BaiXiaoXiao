/**
 * 小鸮的对外门面。
 *
 * 真正的实现在 utils/agent/ 下：nlu（抽槽与模糊匹配）+ faq（TF-IDF 检索）
 * + index（工具注册表与运行时）。这里只保留一个 answer() 兼容函数，
 * 让页面和旧测试不必关心内部结构。
 *
 * 注意：小程序不支持 require 目录，所以必须显式写到 index.js。
 */

const { ask } = require('./agent/index.js');

function answer(text, context) {
  return ask(text, context).text;
}

module.exports = { answer, ask };
