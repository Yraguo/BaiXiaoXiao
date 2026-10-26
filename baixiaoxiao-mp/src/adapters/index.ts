/**
 * 适配层统一出口
 *
 * 业务代码只从这里 import，不要直接 `@/adapters/xxx`。
 * 好处：将来某个能力换实现（比如把存储从 Storage 换成云数据库），
 * 只改这个文件的 re-export，20 个页面一行不用动。
 */
export * from './platform';
export * from './storage';
export * from './request';
export * from './crypto';
export * from './notify';
export * from './jw';
