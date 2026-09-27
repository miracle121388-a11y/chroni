import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { checkRelease } from './check-release.mjs';
const root = mkdtempSync(join(tmpdir(), 'release-check-'));
const body = 'test artifact';
writeFileSync(join(root, 'app.pkg'), body);
const keys = ['identity','artifact','runtime','releaseReview','metadata','privacy','websites','pricingAvailability','reviewAccess','exportCompliance','releaseMode','ascValidation','submissionLookup'];
function fixture() {
  return {schemaVersion:1,intent:'submit',target:{teamId:'TEAM',appId:'123',bundleId:'com.example.test',platform:'MAC_OS',deviceFamilies:['Mac'],version:'1.0',versionId:'v1',buildNumber:'1',buildId:'b1'},build:{appId:'123',platform:'MAC_OS',deviceFamilies:['Mac'],version:'1.0',buildNumber:'1',buildId:'b1'},remote:{buildState:'VALID',submissionState:'NONE',submissionId:null},artifact:{path:'app.pkg',sha256:createHash('sha256').update(body).digest('hex')},features:{digitalGoods:false,gameCenter:false},checks:Object.fromEntries(keys.map(k=>[k,{status:'pass',evidence:'fixture verification',checkedAt:'2026-09-27T08:00:00Z'}])),blockers:[]};
}
try {
  await test('a complete internally consistent record passes',async()=>assert.equal((await checkRelease(fixture(),root)).ready,true));
  for (const [label,change,field] of [
    ['wrong app',r=>r.build.appId='999','build.appId'],
    ['wrong platform',r=>r.build.platform='IOS','build.platform'],
    ['changed binary',r=>r.artifact.sha256='0'.repeat(64),'artifact.sha256'],
    ['unpublished privacy',r=>r.checks.privacy.status='unknown','checks.privacy'],
    ['existing active submission',r=>r.remote.submissionState='WAITING_FOR_REVIEW','remote.submissionState'],
    ['ambiguous draft',r=>r.remote.submissionState='READY_FOR_REVIEW','remote.submissionId'],
    ['unreviewed subscription',r=>r.features.digitalGoods=true,'checks.digitalGoods'],
    ['prepare-only request',r=>r.intent='prepare','intent'],
    ['known blocker',r=>r.blockers.push('support 404'),'blockers'],
    ['missing artifact',r=>r.artifact.path='missing.pkg','artifact.path'],
    ['missing runtime evidence',r=>r.checks.runtime.evidence='','checks.runtime'],
  ]) await test(label,async()=>{const r=fixture();change(r);const report=await checkRelease(r,root);assert.equal(report.ready,false);assert.ok(report.issues.some(i=>i.field===field));});
  await test('a resolved existing draft can be reused',async()=>{const r=fixture();r.remote={buildState:'VALID',submissionState:'READY_FOR_REVIEW',submissionId:'s1'};assert.equal((await checkRelease(r,root)).ready,true);});
  for (const devices of [['iPhone'], ['iPad'], ['iPhone','iPad']]) {
    await test('IOS supports '+devices.join('+'),async()=>{const r=fixture();r.target.platform=r.build.platform='IOS';r.target.deviceFamilies=r.build.deviceFamilies=devices;assert.equal((await checkRelease(r,root)).ready,true);});
  }
  await test('iPadOS is not a separate ASC platform',async()=>{const r=fixture();r.target.platform=r.build.platform='IPADOS';assert.equal((await checkRelease(r,root)).ready,false);});
  await test('iPad advertised but absent in artifact blocks',async()=>{const r=fixture();r.target.platform=r.build.platform='IOS';r.target.deviceFamilies=['iPhone','iPad'];r.build.deviceFamilies=['iPhone'];const result=await checkRelease(r,root);assert.ok(result.issues.some(i=>i.field==='build.deviceFamilies'));});
  await test('Mac device family cannot be submitted as IOS',async()=>{const r=fixture();r.target.platform=r.build.platform='IOS';assert.equal((await checkRelease(r,root)).ready,false);});
  await test('invalid input fails closed',async()=>assert.equal((await checkRelease(null,root)).ready,false));
} finally { rmSync(root,{recursive:true,force:true}); }
