import { describe, expect, it } from 'vitest';
import { indexAt, tocPaths } from './toc.js';

describe('tocPaths', () => {
  it('条ごとに編・章・節・款の並びを返す', () => {
    const kan = { title: '第一款　所有権の内容及び範囲', children: ['206', '207'] };
    const setsu = { title: '第一節　所有権の限界', children: [kan] };
    const shou = { title: '第三章　所有権', children: [setsu] };
    const hen = { title: '第二編　物権', children: [{ title: '第一章　総則', children: ['175'] }, shou] };
    const m = tocPaths([hen]);
    expect(m.get('206').map((n) => n.title)).toEqual(['第二編　物権', '第三章　所有権', '第一節　所有権の限界', '第一款　所有権の内容及び範囲']);
    expect(m.get('175').map((n) => n.title)).toEqual(['第二編　物権', '第一章　総則']);
  });

  it('目次の無い法令は空', () => {
    expect(tocPaths([]).size).toBe(0);
  });
});

describe('indexAt', () => {
  const bottoms = [100, 200, 300];
  const at = (y) => indexAt(bottoms.length, (i) => bottoms[i], y);
  it('上端にかかっている条', () => {
    expect(at(0)).toBe(0);
    expect(at(150)).toBe(1);
    expect(at(200)).toBe(2); // 下端ちょうどは次の条
  });
  it('全部過ぎたら length（附則）', () => {
    expect(at(400)).toBe(3);
  });
});
