#!/usr/bin/env node
// Offline consistency check. Evidence must be gathered independently; never submits.
import { readFileSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkRelease(record, baseDir) {
  const issues = [];
  const fail = (field, message) => issues.push({ field, message });
  const present = value => typeof value === 'string' && value.trim().length > 0;
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ready: false, scope: 'offline-record-consistency', issues: [{ field: '$', message: '记录必须为 JSON 对象' }] };
  }
  if (record.schemaVersion !== 1) fail('schemaVersion', '仅支持记录版本 1');
  const target = record.target ?? {};
  for (const field of ['teamId', 'appId', 'bundleId', 'platform', 'version', 'versionId', 'buildNumber', 'buildId']) {
    if (!present(target[field])) fail(`target.${field}`, '缺少明确目标');
  }
  if (!['IOS', 'MAC_OS'].includes(target.platform)) fail('target.platform', '此预检仅支持 IOS 或 MAC_OS');
  const allowedFamilies = target.platform === 'IOS' ? ['iPhone', 'iPad'] : ['Mac'];
  const families = target.deviceFamilies;
  if (!Array.isArray(families) || !families.length || new Set(families).size !== families.length || families.some(f => !allowedFamilies.includes(f))) {
    fail('target.deviceFamilies', '设备家族必须明确，且与商店平台匹配');
  }
  const builtFamilies = record.build?.deviceFamilies;
  if (!Array.isArray(builtFamilies) || !Array.isArray(families) || JSON.stringify([...builtFamilies].sort()) !== JSON.stringify([...families].sort())) {
    fail('build.deviceFamilies', '产物实际设备支持与发布目标不一致');
  }
  if (!['prepare', 'upload', 'submit', 'status'].includes(record.intent)) fail('intent', '未知发布意图');
  if (record.intent !== 'submit') fail('intent', '此预检用于最终送审；当前意图不能据此送审');
  if (record.remote?.submissionState !== 'NONE' && record.remote?.submissionState !== 'READY_FOR_REVIEW') {
    fail('remote.submissionState', '未知、活跃或已完成提交：先读取远端状态，不可重复送审');
  }
  if (record.remote?.submissionState === 'READY_FOR_REVIEW' && !present(record.remote.submissionId)) {
    fail('remote.submissionId', '已有草稿必须记录确切 ID');
  }
  if (record.remote?.submissionState === 'NONE' && record.remote?.submissionId) fail('remote.submissionId', '无提交状态与已有 ID 冲突');
  if (record.remote?.buildState !== 'VALID') fail('remote.buildState', '构建尚未验证为 VALID');
  for (const field of ['appId', 'platform', 'version', 'buildNumber', 'buildId']) {
    if (!present(record.build?.[field]) || record.build[field] !== target[field]) fail(`build.${field}`, '所选构建与目标不一致或缺失');
  }
  if (!Array.isArray(record.blockers)) fail('blockers', '必须显式记录阻塞列表');
  else if (record.blockers.length) fail('blockers', '仍有未解决阻塞');
  const required = ['identity', 'artifact', 'runtime', 'releaseReview', 'metadata', 'privacy', 'websites', 'pricingAvailability', 'reviewAccess', 'exportCompliance', 'releaseMode', 'ascValidation', 'submissionLookup'];
  for (const key of required) {
    const check = record.checks?.[key];
    if (check?.status !== 'pass' || !present(check?.evidence) || !present(check?.checkedAt) || !Number.isFinite(Date.parse(check.checkedAt))) {
      fail(`checks.${key}`, '必要检查需 pass、证据说明及有效核验时间，未知不算通过');
    }
  }
  const goods = record.features?.digitalGoods;
  if (typeof goods !== 'boolean') fail('features.digitalGoods', '明确是否含内购/订阅');
  const game = record.features?.gameCenter;
  if (typeof game !== 'boolean') fail('features.gameCenter', '明确是否含 Game Center');
  for (const [key, enabled] of [['digitalGoods', goods], ['gameCenter', game]]) {
    if (enabled && (record.checks?.[key]?.status !== 'pass' || !present(record.checks?.[key]?.evidence) || !Number.isFinite(Date.parse(record.checks?.[key]?.checkedAt)))) {
      fail(`checks.${key}`, '相关审核项目尚无通过证据');
    }
  }
  const artifact = record.artifact ?? {};
  if (!present(artifact.path) || !/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? '')) fail('artifact', '需实际产物路径与 SHA-256');
  else {
    try {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(resolve(baseDir, artifact.path))) hash.update(chunk);
      if (hash.digest('hex') !== artifact.sha256.toLowerCase()) fail('artifact.sha256', '产物内容已变化，重新核验并确认上传构建');
    } catch (error) { fail('artifact.path', `无法读取产物：${error.code ?? 'READ_ERROR'}`); }
  }
  return { ready: issues.length === 0, scope: 'offline-record-consistency', issues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('用法：node check-release.mjs <发布记录.json>');
    const file = resolve(process.argv[2]);
    const report = await checkRelease(JSON.parse(readFileSync(file, 'utf8')), dirname(file));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ready ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
