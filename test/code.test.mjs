import test from 'node:test';
import assert from 'node:assert';

import {
  CODE_LANGUAGES, INDENT_UNIT, TAB_CHAR, detectLanguage, fenceFor, highlight, normalizeLang, searchLanguages,
} from '../src/js/code.js';
import { parseBlocks, blockToLines } from '../src/js/markdown.js';

test('语言表：包含 Typora 的常用语言，别名能归一化', () => {
  for (const lang of ['javascript', 'typescript', 'python', 'html', 'css', 'json', 'yaml', 'shell', 'c++', 'c#']) {
    assert.ok(CODE_LANGUAGES.includes(lang), '缺少语言 ' + lang);
  }
  assert.equal(normalizeLang('JS'), 'javascript');
  assert.equal(normalizeLang('ts'), 'typescript');
  assert.equal(normalizeLang('py'), 'python');
  assert.equal(normalizeLang('bash'), 'shell');
  assert.equal(normalizeLang('csharp'), 'c#');
  assert.equal(normalizeLang('text'), '');
  assert.ok(searchLanguages('py').includes('python'));
  assert.ok(searchLanguages('js').includes('javascript'));
});

test('代码高亮：JS 关键字 / 字符串 / 注释，HTML 被转义', () => {
  const html = highlight('const s = "<b>"; // hi', 'js');
  assert.match(html, /tok-kw/);
  assert.match(html, /tok-str/);
  assert.match(html, /tok-com/);
  assert.match(html, /&lt;b&gt;/);
  assert.equal(html.includes('<b>'), false);
});

test('代码高亮：数字、函数名、类型', () => {
  const html = highlight('function f(x) { return new Foo(42); }', 'javascript');
  assert.match(html, /tok-fn[^>]*>f</);
  assert.match(html, /tok-type[^>]*>Foo</);
  assert.match(html, /tok-num[^>]*>42</);
});

test('代码高亮：HTML / JSON / 未知语言', () => {
  const html = highlight('<div class="a">x & y</div>', 'html');
  assert.match(html, /tok-tag[^>]*>div</);
  assert.match(html, /tok-attr[^>]*>class</);
  assert.ok(html.includes('&lt;'));
  assert.equal(html.includes('<div'), false);
  assert.equal(html.includes('<span class="tok-tag">div</span>'), true);

  const json = highlight('{"a": 1, "b": true}', 'json');
  assert.match(json, /tok-key[^>]*>&quot;a&quot;</);
  assert.match(json, /tok-const[^>]*>true</);

  assert.equal(highlight('<b>x</b>', '没有这个语言'), '&lt;b&gt;x&lt;/b&gt;');
  assert.equal(highlight('<b>x</b>', ''), '&lt;b&gt;x&lt;/b&gt;');
});

test('缩进单位：Typora 默认 2 空格自动缩进、手按 Tab 是制表符', () => {
  assert.equal(INDENT_UNIT, '  ');
  assert.equal(TAB_CHAR, '\t');
});

test('围栏：代码里有 ``` 行时自动加长', () => {
  const open = fenceFor('a\n```\nb', 'js');
  assert.equal(open, '````js');
  const md = blockToLines({ type: 'code', src: 'a\n```\nb', lang: 'js' }).join('\n');
  assert.equal(md, '````js\na\n```\nb\n````');
  const parsed = parseBlocks(md);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, 'code');
  assert.equal(parsed[0].src, 'a\n```\nb');
});

test('代码块：语言、开头 / 结尾空行往返不丢', () => {
  const md = ['```js', '', 'const a = 1;', '', '```'].join('\n');
  const blocks = parseBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].lang, 'js');
  assert.equal(blocks[0].src, '\nconst a = 1;\n');

  const out = blockToLines(blocks[0]).join('\n');
  const again = parseBlocks(out);
  assert.equal(again.length, 1);
  assert.equal(again[0].lang, 'js');
  assert.equal(again[0].src, '\nconst a = 1;\n');
});

test('代码块：空代码块与语言名都保留', () => {
  const blocks = parseBlocks('```python\n\n```');
  assert.equal(blocks[0].src, '');
  assert.equal(blocks[0].lang, 'python');
  assert.deepEqual(blockToLines(blocks[0]), ['```python', '', '```']);
});

test('自动识别：常见代码语言', () => {
  const cases = [
    ['const x = 1;\nconsole.log(x);', 'javascript'],
    ['interface User { name: string; }', 'typescript'],
    ['const el = <div className="x">hi</div>;', 'jsx'],
    ['def add(a, b):\n    return a + b', 'python'],
    ['<!DOCTYPE html>\n<html><body>hi</body></html>', 'html'],
    ['{"a": 1, "b": [true, null]}', 'json'],
    ['.card { color: red; font-size: 12px; }', 'css'],
    ['SELECT id FROM users WHERE age > 18;', 'sql'],
    ['package main\nfunc main() { fmt.Println("hi") }', 'go'],
    ['fn main() { let mut x = 1; println!("{}", x); }', 'rust'],
    ['public class Main { public static void main(String[] a) { System.out.println("hi"); } }', 'java'],
    ['using System;\nclass P { static void Main() { Console.WriteLine("hi"); } }', 'c#'],
    ['#include <stdio.h>\nint main() { printf("hi"); }', 'c'],
    ['#include <iostream>\nint main() { std::cout << "hi"; }', 'c++'],
    ['class Animal {\npublic:\n    virtual void speak() {}\n};', 'c++'],
    ['name: John\nage: 30', 'yaml'],
    ['name: John\ntype: string', 'yaml'],
    ['#!/bin/bash\necho $HOME', 'shell'],
    ['FROM node:18\nRUN npm install', 'dockerfile'],
    ['@@ -1,2 +1,2 @@\n-old\n+new', 'diff'],
    ['fun main() { println("hi") }', 'kotlin'],
    ['func main() { let x = 1 }', 'swift'],
    ['这是一段普通文字，不是代码。', ''],
    ['', ''],
  ];
  for (const [src, expected] of cases) {
    assert.equal(detectLanguage(src), expected, JSON.stringify(src));
  }
});
